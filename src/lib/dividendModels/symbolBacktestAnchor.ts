import type Database from "better-sqlite3";

import { monthEndForDate } from "./dates";
import { readSymbolMonthlyFacts } from "./symbolMonthlyMarket";

export type BacktestWindowYears = 1 | 3 | 5;

const WINDOWS: BacktestWindowYears[] = [1, 3, 5];

/** First month-end on or after the window cutoff (UTC). */
export function anchorMonthEndForWindowYears(now: Date, windowYears: BacktestWindowYears): string {
  const startAnchor = new Date(Date.UTC(now.getUTCFullYear() - windowYears, now.getUTCMonth(), 1));
  return monthEndForDate(startAnchor);
}

export function persistSymbolBacktestAnchors(
  db: Database.Database,
  symbols: string[],
  now: Date = new Date(),
): number {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (uniq.length === 0) return 0;

  const computedAt = now.toISOString();
  const upsert = db.prepare(
    `
    INSERT INTO symbol_backtest_anchor (symbol, window_years, anchor_month_end, close_eom, price_source, computed_at)
    VALUES (@symbol, @window_years, @anchor_month_end, @close_eom, @price_source, @computed_at)
    ON CONFLICT(symbol, window_years) DO UPDATE SET
      anchor_month_end = excluded.anchor_month_end,
      close_eom = excluded.close_eom,
      price_source = excluded.price_source,
      computed_at = excluded.computed_at
  `,
  );

  let rows = 0;
  const write = db.transaction(() => {
    for (const sym of uniq) {
      for (const wy of WINDOWS) {
        const anchorMe = anchorMonthEndForWindowYears(now, wy);
        const facts = readSymbolMonthlyFacts(db, sym, anchorMe);
        const close = facts?.close_eom ?? null;
        upsert.run({
          symbol: sym,
          window_years: wy,
          anchor_month_end: anchorMe,
          close_eom: close,
          price_source: close != null ? "schwab_ohlcv" : "missing",
          computed_at: computedAt,
        });
        rows += 1;
      }
    }
  });
  write();
  return rows;
}

export function readBacktestAnchorClose(
  db: Database.Database,
  symbol: string,
  windowYears: BacktestWindowYears,
): number | null {
  const row = db
    .prepare(
      `
      SELECT close_eom AS closeEom
      FROM symbol_backtest_anchor
      WHERE symbol = ? AND window_years = ?
    `,
    )
    .get(symbol.toUpperCase(), windowYears) as { closeEom: number | null } | undefined;
  const c = row?.closeEom;
  return c != null && Number.isFinite(c) && c > 0 ? c : null;
}
