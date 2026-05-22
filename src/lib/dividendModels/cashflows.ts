import type Database from "better-sqlite3";

/** Dividend cashflows for a symbol in [startIso, endIso] on calendar pay_date (YYYY-MM-DD). */
export function sumDividendCashflowsByPayDateRange(
  db: Database.Database,
  symbol: string,
  startIso: string,
  endIso: string,
  /** When set, only cashflows for this brokerage account (Schwab slice). */
  accountId?: string | null,
): number {
  const sym = (symbol ?? "").trim().toUpperCase();
  const acct = accountId?.trim() ?? "";
  const row = db
    .prepare(
      acct
        ? `
      SELECT COALESCE(SUM(cf.amount), 0) AS total
      FROM cashflows cf
      LEFT JOIN securities s ON s.id = cf.security_id
      WHERE (s.symbol IS NOT NULL AND UPPER(s.symbol) = @sym)
        AND cf.account_id = @acct
        AND cf.type IN ('dividend_actual', 'dividend_projected')
        AND substr(cf.pay_date, 1, 10) >= @startIso
        AND substr(cf.pay_date, 1, 10) <= @endIso
    `
        : `
      SELECT COALESCE(SUM(cf.amount), 0) AS total
      FROM cashflows cf
      LEFT JOIN securities s ON s.id = cf.security_id
      WHERE (s.symbol IS NOT NULL AND UPPER(s.symbol) = @sym)
        AND cf.type IN ('dividend_actual', 'dividend_projected')
        AND substr(cf.pay_date, 1, 10) >= @startIso
        AND substr(cf.pay_date, 1, 10) <= @endIso
    `,
    )
    .get({ sym, startIso, endIso, acct }) as { total: number } | undefined;
  return typeof row?.total === "number" && Number.isFinite(row.total) ? row.total : 0;
}

/** Next upcoming ex_date for symbol (if any). */
export function nextExDateForSymbol(db: Database.Database, symbol: string, fromIso: string): string | null {
  const sym = (symbol ?? "").trim().toUpperCase();
  const row = db
    .prepare(
      `
      SELECT substr(cf.ex_date, 1, 10) AS exd
      FROM cashflows cf
      LEFT JOIN securities s ON s.id = cf.security_id
      WHERE (s.symbol IS NOT NULL AND UPPER(s.symbol) = @sym)
        AND cf.ex_date IS NOT NULL
        AND substr(cf.ex_date, 1, 10) >= @fromIso
      ORDER BY cf.ex_date ASC
      LIMIT 1
    `,
    )
    .get({ sym, fromIso }) as { exd: string } | undefined;
  return row?.exd ?? null;
}

/** Next upcoming dividend-related calendar date (earlier of next ex-date or next pay-date on/after fromIso). */
export function nextDividendCalendarDate(db: Database.Database, symbol: string, fromIso: string): string | null {
  const sym = (symbol ?? "").trim().toUpperCase();
  const row = db
    .prepare(
      `
      SELECT MIN(d) AS d
      FROM (
        SELECT substr(cf.ex_date, 1, 10) AS d
        FROM cashflows cf
        LEFT JOIN securities s ON s.id = cf.security_id
        WHERE (s.symbol IS NOT NULL AND UPPER(s.symbol) = @sym)
          AND cf.type IN ('dividend_actual', 'dividend_projected')
          AND cf.ex_date IS NOT NULL
          AND substr(cf.ex_date, 1, 10) >= @fromIso
        UNION ALL
        SELECT substr(cf.pay_date, 1, 10) AS d
        FROM cashflows cf
        LEFT JOIN securities s ON s.id = cf.security_id
        WHERE (s.symbol IS NOT NULL AND UPPER(s.symbol) = @sym)
          AND cf.type IN ('dividend_actual', 'dividend_projected')
          AND substr(cf.pay_date, 1, 10) >= @fromIso
      ) AS u
    `,
    )
    .get({ sym, fromIso }) as { d: string | null } | undefined;
  return row?.d ?? null;
}
