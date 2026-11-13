import type Database from "better-sqlite3";

import { correlationForWindow } from "@/lib/screener/correlation";
import { deriveCrossChecks, pullAlphaVantage, pullFinnhub, pullFmp, pullSchwab, pullSec, pullYahooAdjustedCloses, pullYahooSummary, type SourceAttempt } from "@/lib/screener/fetchers";
import { listSecurities, replaceAdjustedCloses, upsertObservation } from "@/lib/screener/store";
import type { CorrWindow, ObservationInput } from "@/lib/screener/types";
import { CORR_WINDOWS } from "@/lib/screener/types";

import { SCREENER_REFRESH_LIMIT } from "@/lib/screener/name";

export const REFRESH_LIMIT = SCREENER_REFRESH_LIMIT;
const PRICE_SOURCE = "yahoo_adjclose";

export type RefreshDeps = {
  fundamentals?: (db: Database.Database, ticker: string, cik: number | null) => Promise<SourceAttempt[]>;
  adjustedCloses?: (db: Database.Database, symbol: string) => Promise<Array<{ date: string; adjClose: number }> | null>;
  now?: () => string;
};

async function defaultFundamentals(db: Database.Database, ticker: string, cik: number | null): Promise<SourceAttempt[]> {
  const attempts = await Promise.all([
    pullSchwab(ticker).catch((error) => failed("schwab", error)),
    pullYahooSummary(db, ticker).catch((error) => failed("yahoo", error)),
    pullFinnhub(db, ticker).catch((error) => failed("finnhub", error)),
    pullFmp(db, ticker).catch((error) => failed("fmp", error)),
    pullAlphaVantage(db, ticker).catch((error) => failed("alphavantage", error)),
    pullSec(db, ticker, cik).catch((error) => failed("sec", error)),
  ]);
  return attempts;
}

function failed(source: string, error: unknown): SourceAttempt {
  return { source, status: "failed", detail: error instanceof Error ? error.message : String(error), observations: [] };
}

export type RefreshReport = {
  requested: string[];
  refreshed: string[];
  deferred: string[];
  attempts: Array<{ ticker: string; source: string; status: string; detail?: string }>;
};

function correlationObservations(
  ticker: string,
  stock: Array<{ date: string; adjClose: number }>,
  spy: Array<{ date: string; adjClose: number }>,
  qqq: Array<{ date: string; adjClose: number }>,
): ObservationInput[] {
  const out: ObservationInput[] = [];
  for (const window of CORR_WINDOWS) {
    const pairs: Array<[CorrWindow, "corr_spy" | "corr_qqq", Array<{ date: string; adjClose: number }>, string]> = [
      [window, "corr_spy", spy, "SPY"],
      [window, "corr_qqq", qqq, "QQQ"],
    ];
    for (const [active, field, bench, name] of pairs) {
      const result = correlationForWindow(stock, bench, active);
      if (!result) continue;
      out.push({
        field,
        source: PRICE_SOURCE,
        valueNum: result.value,
        asOf: result.end,
        meta: {
          window: active,
          benchmark: name,
          pairedReturns: result.pairedReturns,
          targetReturns: result.targetReturns,
          shortHistory: result.shortHistory,
          start: result.start,
          end: result.end,
          method: "Pearson correlation of daily simple returns from adjusted closes",
          priceSource: "Yahoo Finance chart adjclose",
        },
      });
    }
  }
  return out;
}

export async function refreshScreener(db: Database.Database, tickers: string[], deps: RefreshDeps = {}): Promise<RefreshReport> {
  const now = deps.now ?? (() => new Date().toISOString());
  const fundamentals = deps.fundamentals ?? defaultFundamentals;
  const adjustedCloses = deps.adjustedCloses ?? pullYahooAdjustedCloses;
  const requested = [...new Set(tickers.map((ticker) => ticker.trim().toUpperCase()).filter(Boolean))];
  const batch = requested.slice(0, REFRESH_LIMIT);
  const deferred = requested.slice(REFRESH_LIMIT);
  const securities = new Map(listSecurities(db).map((row) => [row.ticker, row]));
  const attempts: RefreshReport["attempts"] = [];
  const refreshed: string[] = [];

  let spy: Array<{ date: string; adjClose: number }> | null = null;
  let qqq: Array<{ date: string; adjClose: number }> | null = null;
  try {
    spy = await adjustedCloses(db, "SPY");
    qqq = await adjustedCloses(db, "QQQ");
  } catch {
    spy = null;
    qqq = null;
  }
  const fetchedAt = now();
  if (spy) replaceAdjustedCloses(db, PRICE_SOURCE, "SPY", spy, fetchedAt);
  if (qqq) replaceAdjustedCloses(db, PRICE_SOURCE, "QQQ", qqq, fetchedAt);
  if (!spy || !qqq) {
    attempts.push({
      ticker: "SPY",
      source: PRICE_SOURCE,
      status: "failed",
      detail: "Adjusted closes for SPY or QQQ were unavailable, so correlations were left unchanged",
    });
  }

  for (const ticker of batch) {
    let sourceAttempts: SourceAttempt[] = [];
    try {
      sourceAttempts = await fundamentals(db, ticker, securities.get(ticker)?.cik ?? null);
    } catch (error) {
      sourceAttempts = [failed("fundamentals", error)];
    }
    const observations: ObservationInput[] = [];
    for (const attempt of sourceAttempts) {
      attempts.push({ ticker, source: attempt.source, status: attempt.status, detail: attempt.detail });
      if (attempt.status === "ok") observations.push(...attempt.observations);
    }
    try {
      observations.push(...deriveCrossChecks(observations));
    } catch {
      attempts.push({ ticker, source: "sec_computed", status: "failed", detail: "Cross-check was not stored" });
    }
    const stamp = now();
    for (const observation of observations) {
      if (observation.valueNum == null && (observation.valueText == null || observation.valueText === "")) continue;
      upsertObservation(db, ticker, observation, stamp);
    }

    if (spy && qqq) {
      try {
        const bars = await adjustedCloses(db, ticker);
        if (!bars) {
          attempts.push({ ticker, source: PRICE_SOURCE, status: "failed", detail: "No adjusted closes" });
        } else {
          replaceAdjustedCloses(db, PRICE_SOURCE, ticker, bars, stamp);
          for (const observation of correlationObservations(ticker, bars, spy, qqq)) {
            upsertObservation(db, ticker, observation, stamp);
          }
          attempts.push({ ticker, source: PRICE_SOURCE, status: "ok" });
        }
      } catch (error) {
        attempts.push({
          ticker,
          source: PRICE_SOURCE,
          status: "failed",
          detail: error instanceof Error ? error.message : String(error),
        });
      }
    }
    refreshed.push(ticker);
  }

  return { requested, refreshed, deferred, attempts };
}
