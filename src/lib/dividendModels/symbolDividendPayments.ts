import type Database from "better-sqlite3";

import { logError } from "@/lib/log";
import type { YahooDividendPayment } from "@/lib/market/yahooChartDividends";
import { fetchYahooDividendPayments } from "@/lib/market/yahooChartDividends";

/** Upsert dividend payment rows for one symbol (used during monthly backfill). */
export function upsertDividendPaymentsForSymbol(
  db: Database.Database,
  symbol: string,
  payments: YahooDividendPayment[],
  capturedAt: string,
): number {
  const sym = symbol.trim().toUpperCase();
  if (payments.length === 0) return 0;
  const upsert = db.prepare(
    `
    INSERT INTO symbol_dividend_payments (symbol, pay_date, amount, source, captured_at)
    VALUES (@symbol, @pay_date, @amount, @source, @captured_at)
    ON CONFLICT(symbol, pay_date, amount) DO UPDATE SET
      source = excluded.source,
      captured_at = excluded.captured_at
  `,
  );
  let rowsUpserted = 0;
  const write = db.transaction(() => {
    for (const p of payments) {
      const payDate = p.payDateIso.slice(0, 10);
      if (payDate.length < 10) continue;
      upsert.run({
        symbol: sym,
        pay_date: payDate,
        amount: p.amount,
        source: "yahoo_chart_div",
        captured_at: capturedAt,
      });
      rowsUpserted += 1;
    }
  });
  write();
  return rowsUpserted;
}

/** Upsert 5y Yahoo dividend payment events for symbols. */
export async function upsertSymbolDividendPayments(
  db: Database.Database,
  symbols: string[],
): Promise<{ symbolsProcessed: number; rowsUpserted: number }> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  if (uniq.length === 0) return { symbolsProcessed: 0, rowsUpserted: 0 };

  const capturedAt = new Date().toISOString();
  let rowsUpserted = 0;
  for (const sym of uniq) {
    try {
      const payments = await fetchYahooDividendPayments(sym);
      rowsUpserted += upsertDividendPaymentsForSymbol(db, sym, payments, capturedAt);
    } catch (e) {
      logError(`symbol_dividend_payments_${sym}`, e);
    }
  }

  return { symbolsProcessed: uniq.length, rowsUpserted };
}
