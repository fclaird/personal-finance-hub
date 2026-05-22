import type Database from "better-sqlite3";

import { logError } from "@/lib/log";
import { newId } from "@/lib/id";

import { fetchMergedDividendFundamentals } from "./mergedFundamentals";

/** Force-fetch Schwab/Yahoo fundamentals and append snapshot rows. */
export async function captureFundamentalsForSymbols(
  db: Database.Database,
  symbols: string[],
  opts?: { skipYahoo?: boolean },
): Promise<{ captured: number }> {
  const uniq = [...new Set(symbols.map((s) => s.trim().toUpperCase()).filter(Boolean))];
  const now = new Date().toISOString();
  const ins = db.prepare(
    `
    INSERT INTO dividend_model_symbol_fundamentals_snap
      (id, symbol, captured_at, display_name, div_yield, annual_div_est, next_ex_date, raw_json, source)
    VALUES
      (@id, @symbol, @captured_at, @display_name, @div_yield, @annual_div_est, @next_ex_date, @raw_json, @source)
  `,
  );

  let captured = 0;
  const BATCH = opts?.skipYahoo ? 2 : 4;
  for (let i = 0; i < uniq.length; i += BATCH) {
    const slice = uniq.slice(i, i + BATCH);
    await Promise.all(
      slice.map(async (sym) => {
        try {
          const m = await fetchMergedDividendFundamentals(sym, { skipYahoo: opts?.skipYahoo });
          ins.run({
            id: newId("dmfs"),
            symbol: sym,
            captured_at: now,
            display_name: m.displayName,
            div_yield: m.divYield,
            annual_div_est: m.annualDivEst,
            next_ex_date: m.nextExDate,
            raw_json: JSON.stringify(m.raw ?? {}),
            source: m.source,
          });
          captured += 1;
        } catch (e) {
          logError(`dividend_model_fundamental_${sym}`, e);
        }
      }),
    );
  }

  return { captured };
}
