import type Database from "better-sqlite3";

import {
  blackScholesDelta,
  impliedVolFromPrice,
} from "@/lib/options/shortStrangleRiskProfile";
import { nyCalendarIso } from "@/lib/analytics/allocationNyDate";
import { optionDte } from "@/lib/strategy/optionParse";

const DEFAULT_RATE = 0.045;
/** Prefer 5m bars within this window of the trade; otherwise fall back to daily. */
const FIVE_M_MAX_GAP_MS = 3 * 24 * 60 * 60 * 1000;

/** Normalize Schwab timestamps like 2026-09-02T19:26:55+0000 for Date.parse. */
export function parseTradeTimeMs(tradeTime: string | null | undefined, tradeDate?: string | null): number | null {
  if (tradeTime) {
    let s = tradeTime.trim();
    // Schwab often emits +0000 without a colon
    if (/[+-]\d{4}$/.test(s)) {
      s = s.replace(/([+-]\d{2})(\d{2})$/, "$1:$2");
    }
    const ms = Date.parse(s);
    if (Number.isFinite(ms)) return ms;
  }
  if (tradeDate) {
    const ms = Date.parse(`${tradeDate.slice(0, 10)}T16:00:00Z`);
    if (Number.isFinite(ms)) return ms;
  }
  return null;
}

/** Underlying spot near trade time from ohlcv_points (5m nearest, else 1d on/before). */
export function lookupSpotNearTrade(
  db: Database.Database,
  underlying: string,
  tradeTimeMs: number,
): number | null {
  const sym = (underlying ?? "").trim().toUpperCase();
  if (!sym || !Number.isFinite(tradeTimeMs)) return null;

  const near5m = db
    .prepare(
      `
      SELECT close AS close, ts_ms AS tsMs
      FROM ohlcv_points
      WHERE provider = 'schwab' AND symbol = ? AND interval = '5m'
        AND close IS NOT NULL
      ORDER BY ABS(ts_ms - ?)
      LIMIT 1
    `,
    )
    .get(sym, tradeTimeMs) as { close: number; tsMs: number } | undefined;

  if (
    near5m &&
    Number.isFinite(near5m.close) &&
    near5m.close > 0 &&
    Math.abs(near5m.tsMs - tradeTimeMs) <= FIVE_M_MAX_GAP_MS
  ) {
    return near5m.close;
  }

  const daily = db
    .prepare(
      `
      SELECT close AS close
      FROM ohlcv_points
      WHERE provider = 'schwab' AND symbol = ? AND interval = '1d'
        AND close IS NOT NULL
        AND ts_ms <= ?
      ORDER BY ts_ms DESC
      LIMIT 1
    `,
    )
    .get(sym, tradeTimeMs) as { close: number } | undefined;

  if (daily && Number.isFinite(daily.close) && daily.close > 0) return daily.close;
  return null;
}

export type FillDeltaInput = {
  underlying: string | null;
  right: "C" | "P" | null;
  strike: number | null;
  expiration: string | null;
  price: number | null;
  tradeDate: string;
  tradeTime: string | null;
};

/** Contract delta at fill via spot + IV solved from premium. */
export function deltaAtFillFromDb(db: Database.Database, input: FillDeltaInput, rate = DEFAULT_RATE): number | null {
  const und = (input.underlying ?? "").trim().toUpperCase();
  if (!und || !input.right || input.strike == null || !(input.strike > 0)) return null;
  if (input.price == null || !(input.price >= 0) || !Number.isFinite(input.price)) return null;

  const tradeMs = parseTradeTimeMs(input.tradeTime, input.tradeDate);
  if (tradeMs == null) return null;

  const spot = lookupSpotNearTrade(db, und, tradeMs);
  if (spot == null) return null;

  const tradeDateNy =
    input.tradeTime && Number.isFinite(Date.parse(input.tradeTime.replace(/([+-]\d{2})(\d{2})$/, "$1:$2")))
      ? nyCalendarIso(new Date(parseTradeTimeMs(input.tradeTime, input.tradeDate)!))
      : input.tradeDate.slice(0, 10);

  const dte = optionDte(tradeDateNy, input.expiration);
  if (dte == null || dte < 0) return null;
  const years = Math.max(dte, 0.5) / 365; // floor tiny DTE so IV/delta remain defined

  const iv = impliedVolFromPrice(input.right, spot, input.strike, years, rate, Math.abs(input.price));
  if (iv == null || !(iv > 0)) return null;

  const delta = blackScholesDelta(input.right, spot, input.strike, years, rate, iv);
  if (delta == null || !Number.isFinite(delta)) return null;
  return Math.round(delta * 1000) / 1000;
}
