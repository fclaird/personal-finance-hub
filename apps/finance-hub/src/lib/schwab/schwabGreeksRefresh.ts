import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import { carryForwardGreeksFromPriorSnapshots, getLatestSchwabSnapshotIds } from "@/lib/schwab/greeksCarryForward";
import { pickSchwabQuotePrice } from "@/lib/schwab/schwabQuotesPersist";
import { schwabMarketFetch } from "@/lib/schwab/client";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";

type QuotePayload = Record<string, unknown>;

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pickGreek(quote: Record<string, unknown>, key: string): number | null {
  return (
    asNumber(quote[key]) ??
    asNumber(quote[key.toLowerCase()]) ??
    asNumber(quote[key.toUpperCase()]) ??
    null
  );
}

function meaningfulGreek(v: number | null): boolean {
  return v != null && Number.isFinite(v) && Math.abs(v) > 1e-12;
}

function greeksPresentOnQuote(quote: Record<string, unknown>): boolean {
  return (
    meaningfulGreek(pickGreek(quote, "delta")) ||
    meaningfulGreek(pickGreek(quote, "gamma")) ||
    meaningfulGreek(pickGreek(quote, "theta")) ||
    meaningfulGreek(pickGreek(quote, "vega")) ||
    meaningfulGreek(pickGreek(quote, "volatility")) ||
    meaningfulGreek(pickGreek(quote, "iv"))
  );
}

/** After hours Schwab often omits greeks or sends delta 0; do not clobber last RTH values. */
export function shouldApplyGreeksFromSchwabQuote(
  quote: Record<string, unknown>,
  rthOpen = isUsEquityRegularSessionOpen(),
): boolean {
  if (rthOpen) return true;
  return greeksPresentOnQuote(quote);
}

export type SchwabGreeksRefreshResult = {
  ok: boolean;
  carryForwardApplied: number;
  /** Option symbols with a greek row upserted from Schwab quotes. */
  updated: number;
  /** Option symbols with a mark/last written to price_points for today. */
  pricesUpdated: number;
  message?: string;
  error?: string;
};

export async function runSchwabGreeksRefresh(db?: Database.Database): Promise<SchwabGreeksRefreshResult> {
  const database = db ?? getDb();
  const snapshotIds = getLatestSchwabSnapshotIds(database);

  if (snapshotIds.length === 0) {
    return {
      ok: false,
      carryForwardApplied: 0,
      updated: 0,
      pricesUpdated: 0,
      error: "No holdings snapshots yet. Run sync first.",
    };
  }

  try {
    const snapshotsJson = JSON.stringify(snapshotIds);
    const carryForwardApplied = carryForwardGreeksFromPriorSnapshots(database, snapshotIds);

    const optionPositions = database
      .prepare(
        `
      SELECT p.id as position_id, s.symbol as symbol, p.quantity as quantity
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN option_greeks og ON og.position_id = p.id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snapshots_json))
        AND s.security_type = 'option'
    `,
      )
      .all({ snapshots_json: snapshotsJson }) as Array<{
      position_id: string;
      symbol: string;
      quantity: number;
    }>;

    const symbols = Array.from(new Set(optionPositions.map((p) => p.symbol).filter(Boolean)));
    if (symbols.length === 0) {
      return {
        ok: true,
        carryForwardApplied,
        updated: 0,
        pricesUpdated: 0,
        message: "No option positions found in latest snapshot.",
      };
    }

    const BATCH = 50;
    let updatedCount = 0;
    let pricesUpdated = 0;
    const today = new Date().toISOString().slice(0, 10);

    const upsertPrice = database.prepare(`
      INSERT INTO price_points (provider, symbol, date, close)
      VALUES ('schwab', @symbol, @date, @close)
      ON CONFLICT(provider, symbol, date) DO UPDATE SET close = excluded.close, created_at = datetime('now')
    `);

    const updatePositionMark = database.prepare(`
      UPDATE positions
      SET market_value = @market_value
      WHERE id = @position_id
    `);

    const upsertGreek = database.prepare(`
    INSERT INTO option_greeks (id, position_id, delta, gamma, theta, vega, iv, updated_at)
    VALUES (@id, @position_id, @delta, @gamma, @theta, @vega, @iv, datetime('now'))
    ON CONFLICT(position_id) DO UPDATE SET
      delta = CASE
        WHEN excluded.delta IS NOT NULL AND ABS(excluded.delta) > 1e-12 THEN excluded.delta
        WHEN excluded.delta IS NOT NULL AND option_greeks.delta IS NULL THEN excluded.delta
        ELSE option_greeks.delta
      END,
      gamma = COALESCE(excluded.gamma, option_greeks.gamma),
      theta = COALESCE(excluded.theta, option_greeks.theta),
      vega = COALESCE(excluded.vega, option_greeks.vega),
      iv = COALESCE(excluded.iv, option_greeks.iv),
      updated_at = CASE
        WHEN excluded.delta IS NOT NULL AND ABS(excluded.delta) > 1e-12
          OR excluded.gamma IS NOT NULL OR excluded.theta IS NOT NULL
          OR excluded.vega IS NOT NULL OR excluded.iv IS NOT NULL
        THEN excluded.updated_at
        ELSE option_greeks.updated_at
      END
  `);

    const rthOpen = isUsEquityRegularSessionOpen();

    const posBySymbol = new Map<string, Array<{ position_id: string; quantity: number }>>();
    for (const p of optionPositions) {
      if (!posBySymbol.has(p.symbol)) posBySymbol.set(p.symbol, []);
      posBySymbol.get(p.symbol)!.push({ position_id: p.position_id, quantity: p.quantity });
    }

    for (let i = 0; i < symbols.length; i += BATCH) {
      const batch = symbols.slice(i, i + BATCH);
      const resp = await schwabMarketFetch<QuotePayload>(`/quotes?symbols=${encodeURIComponent(batch.join(","))}`);

      for (const sym of batch) {
        const entry =
          (resp as Record<string, unknown>)[sym] ??
          (resp as Record<string, unknown>)[sym.toUpperCase()] ??
          (resp as Record<string, unknown>)[sym.trim().toUpperCase()];
        const quote = schwabQuoteObjectFromEntry(entry);
        if (!quote) continue;

        const px = pickSchwabQuotePrice(quote);
        if (px != null && px > 0) {
          upsertPrice.run({ symbol: sym.toUpperCase(), date: today, close: px });
          pricesUpdated++;
        }

        const delta = pickGreek(quote, "delta");
        const gamma = pickGreek(quote, "gamma");
        const theta = pickGreek(quote, "theta");
        const vega = pickGreek(quote, "vega");
        const iv = pickGreek(quote, "volatility") ?? pickGreek(quote, "iv");

        const applyGreeks = shouldApplyGreeksFromSchwabQuote(quote, rthOpen);
        const posRows = posBySymbol.get(sym) ?? [];
        for (const row of posRows) {
          if (px != null && px > 0) {
            const qty = row.quantity ?? 0;
            updatePositionMark.run({
              position_id: row.position_id,
              market_value: qty !== 0 ? px * 100 * qty : null,
            });
          }
          if (applyGreeks) {
            upsertGreek.run({
              id: newId("greek"),
              position_id: row.position_id,
              delta,
              gamma,
              theta,
              vega,
              iv,
            });
          }
        }
        if (applyGreeks) updatedCount++;
      }
    }

    return { ok: true, carryForwardApplied, updated: updatedCount, pricesUpdated };
  } catch (e) {
    return {
      ok: false,
      carryForwardApplied: 0,
      updated: 0,
      pricesUpdated: 0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}
