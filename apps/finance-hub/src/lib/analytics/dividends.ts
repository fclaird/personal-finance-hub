import { getDb } from "@/lib/db";

export type DividendSecurityRow = {
  symbol: string;
  lastMonth: number;
  nextMonth: number;
  nextYearProjected: number;
};

export type DividendSummary = {
  lastMonth: number;
  nextMonth: number;
  nextYearProjected: number;
  bySecurity: DividendSecurityRow[];
};

function monthBoundsUTC(d: Date) {
  const start = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1));
  const end = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth() + 1, 1));
  return { start, end };
}

export function getDividendSummary(): DividendSummary {
  const db = getDb();
  const now = new Date();

  const prev = monthBoundsUTC(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1)));
  const next = monthBoundsUTC(new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1)));
  const yearEnd = new Date(Date.UTC(now.getUTCFullYear() + 1, now.getUTCMonth(), now.getUTCDate()));

  const rows = db
    .prepare(
      `
      SELECT
        COALESCE(sec.symbol, 'UNKNOWN') AS symbol,
        cf.type AS type,
        cf.amount AS amount,
        cf.pay_date AS pay_date
      FROM cashflows cf
      LEFT JOIN securities sec ON sec.id = cf.security_id
      WHERE cf.type IN ('dividend_actual', 'dividend_projected')
    `,
    )
    .all() as Array<{ symbol: string; type: string; amount: number; pay_date: string }>;

  const per = new Map<string, { lastMonth: number; nextMonth: number; nextYear: number }>();
  const add = (sym: string, field: "lastMonth" | "nextMonth" | "nextYear", amt: number) => {
    const cur = per.get(sym) ?? { lastMonth: 0, nextMonth: 0, nextYear: 0 };
    cur[field] += amt;
    per.set(sym, cur);
  };

  for (const r of rows) {
    const pay = new Date(`${r.pay_date}T00:00:00Z`);
    const sym = r.symbol;

    if (pay >= prev.start && pay < prev.end && r.type === "dividend_actual") add(sym, "lastMonth", r.amount);
    if (pay >= next.start && pay < next.end && r.type === "dividend_projected") add(sym, "nextMonth", r.amount);
    if (pay >= now && pay <= yearEnd && r.type === "dividend_projected") add(sym, "nextYear", r.amount);
  }

  const bySecurity: DividendSecurityRow[] = Array.from(per.entries())
    .map(([symbol, v]) => ({
      symbol,
      lastMonth: v.lastMonth,
      nextMonth: v.nextMonth,
      nextYearProjected: v.nextYear,
    }))
    .sort((a, b) => b.nextYearProjected - a.nextYearProjected);

  const totals = bySecurity.reduce(
    (acc, r) => {
      acc.lastMonth += r.lastMonth;
      acc.nextMonth += r.nextMonth;
      acc.nextYearProjected += r.nextYearProjected;
      return acc;
    },
    { lastMonth: 0, nextMonth: 0, nextYearProjected: 0 },
  );

  return { ...totals, bySecurity };
}

