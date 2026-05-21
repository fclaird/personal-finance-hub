import type Database from "better-sqlite3";

import { logError } from "@/lib/log";
import { fetchYahooChartResult } from "@/lib/market/yahooChartFetch";
import { parseDividendRowsFromChartResult } from "@/lib/market/yahooChartDividends";

import { extractYahooLongNameFromChartResult, patchLatestFundamentalsDisplayName } from "./symbolDisplayName";
import { upsertDividendPaymentsForSymbol } from "./symbolDividendPayments";
import { ensureCandles } from "@/lib/terminal/ohlcv";

import { monthEndForDate, monthEndsBetweenInclusive } from "./dates";
import { closeOnOrBeforeTs } from "./prices";

export type SymbolMonthlyMarketRow = {
  symbol: string;
  month_end: string;
  close_eom: number | null;
  dividend_per_share: number;
  annualized_yield_pct: number | null;
  price_source: string;
  dividend_source: string;
};

/** Bucket dividend payments by calendar month-end (pay date month). */
export function bucketDividendsByMonthEnd(payments: Array<{ payDateIso: string; amount: number }>): Map<string, number> {
  const byMonth = new Map<string, number>();
  for (const p of payments) {
    const iso = p.payDateIso.slice(0, 10);
    if (iso.length < 10) continue;
    const me = monthEndForDate(new Date(`${iso}T12:00:00Z`));
    byMonth.set(me, (byMonth.get(me) ?? 0) + p.amount);
  }
  return byMonth;
}

/** Trailing 12-month dividend per share / month-end close, as percent (e.g. 3.5 = 3.5%). */
export function computeTtmYieldPct(
  monthEndsAsc: string[],
  dividendByMonth: Map<string, number>,
  closeByMonth: Map<string, number | null>,
  asOfMonthEnd: string,
): number | null {
  const idx = monthEndsAsc.indexOf(asOfMonthEnd);
  if (idx < 0) return null;
  const close = closeByMonth.get(asOfMonthEnd);
  if (close == null || !Number.isFinite(close) || close <= 0) return null;

  const windowStart = Math.max(0, idx - 11);
  let ttm = 0;
  for (let i = windowStart; i <= idx; i++) {
    ttm += dividendByMonth.get(monthEndsAsc[i]!) ?? 0;
  }
  if (ttm <= 0) return null;
  return (ttm / close) * 100;
}

export async function backfillSymbolMonthlyMarket(
  db: Database.Database,
  symbols: string[],
): Promise<{ symbolsProcessed: number; rowsUpserted: number; paymentRowsUpserted: number }> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (uniq.length === 0) return { symbolsProcessed: 0, rowsUpserted: 0, paymentRowsUpserted: 0 };

  const now = new Date();
  const endMonth = monthEndForDate(now);
  const startAnchor = new Date(Date.UTC(now.getUTCFullYear() - 5, now.getUTCMonth(), 1));
  const startMonth = monthEndForDate(startAnchor);
  const monthEnds = monthEndsBetweenInclusive(startMonth, endMonth);

  const upsert = db.prepare(
    `
    INSERT INTO symbol_monthly_market
      (symbol, month_end, close_eom, dividend_per_share, annualized_yield_pct, price_source, dividend_source, computed_at)
    VALUES
      (@symbol, @month_end, @close_eom, @dividend_per_share, @annualized_yield_pct, @price_source, @dividend_source, @computed_at)
    ON CONFLICT(symbol, month_end) DO UPDATE SET
      close_eom = excluded.close_eom,
      dividend_per_share = excluded.dividend_per_share,
      annualized_yield_pct = excluded.annualized_yield_pct,
      price_source = excluded.price_source,
      dividend_source = excluded.dividend_source,
      computed_at = excluded.computed_at
  `,
  );

  const computedAt = now.toISOString();
  let rowsUpserted = 0;
  let paymentRowsUpserted = 0;

  for (const sym of uniq) {
    try {
      await ensureCandles(sym, "1d", "5Y");

      let divByMonth = new Map<string, number>();
      let divSource = "none";
      try {
        const chart = await fetchYahooChartResult(sym, "div");
        if (chart) {
          const longName = extractYahooLongNameFromChartResult(chart.result);
          if (longName) patchLatestFundamentalsDisplayName(db, sym, longName, "yahoo_chart_meta");

          const rows = parseDividendRowsFromChartResult(chart.result);
          const payments = rows.map((r) => ({
            payDateIso: new Date(r.t * 1000).toISOString().slice(0, 10),
            amount: r.amount,
          }));
          if (payments.length > 0) {
            paymentRowsUpserted += upsertDividendPaymentsForSymbol(db, sym, payments, computedAt);
            divByMonth = bucketDividendsByMonthEnd(payments);
            divSource = "yahoo_chart_div";
          }
        }
      } catch (e) {
        logError(`symbol_monthly_yahoo_${sym}`, e);
      }

      const closeByMonth = new Map<string, number | null>();
      const persist = db.transaction(() => {
        for (const me of monthEnds) {
          const endMs = new Date(`${me}T23:59:59.999Z`).getTime();
          const close = closeOnOrBeforeTs(db, sym, endMs);
          closeByMonth.set(me, close);
          const dps = divByMonth.get(me) ?? 0;
          const yld = computeTtmYieldPct(monthEnds, divByMonth, closeByMonth, me);
          upsert.run({
            symbol: sym,
            month_end: me,
            close_eom: close,
            dividend_per_share: dps,
            annualized_yield_pct: yld,
            price_source: close != null ? "schwab_ohlcv" : "missing",
            dividend_source: divSource,
            computed_at: computedAt,
          });
          rowsUpserted += 1;
        }
      });
      persist();
    } catch (e) {
      logError(`symbol_monthly_backfill_${sym}`, e);
    }
  }

  return { symbolsProcessed: uniq.length, rowsUpserted, paymentRowsUpserted };
}

/** Latest month-end TTM yield % from symbol_monthly_market (after Build history). */
export function readLatestSymbolMonthlyYield(db: Database.Database, symbol: string): number | null {
  const row = db
    .prepare(
      `
      SELECT annualized_yield_pct
      FROM symbol_monthly_market
      WHERE symbol = ? AND annualized_yield_pct IS NOT NULL
      ORDER BY month_end DESC
      LIMIT 1
    `,
    )
    .get(symbol.toUpperCase()) as { annualized_yield_pct: number | null } | undefined;
  const y = row?.annualized_yield_pct;
  return y != null && Number.isFinite(y) && y >= 0 ? y : null;
}

export function readSymbolMonthlyFacts(
  db: Database.Database,
  symbol: string,
  monthEnd: string,
): { close_eom: number | null; dividend_per_share: number; annualized_yield_pct: number | null } | null {
  const row = db
    .prepare(
      `
      SELECT close_eom, dividend_per_share, annualized_yield_pct
      FROM symbol_monthly_market
      WHERE symbol = ? AND month_end = ?
    `,
    )
    .get(symbol, monthEnd) as
    | { close_eom: number | null; dividend_per_share: number; annualized_yield_pct: number | null }
    | undefined;
  if (!row) return null;
  return {
    close_eom: row.close_eom,
    dividend_per_share: row.dividend_per_share ?? 0,
    annualized_yield_pct: row.annualized_yield_pct,
  };
}
