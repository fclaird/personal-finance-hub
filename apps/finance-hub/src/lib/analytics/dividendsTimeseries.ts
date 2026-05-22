import { getDb } from "@/lib/db";

export type DividendMonthPoint = {
  month: string; // YYYY-MM
  actual: number;
  projected: number;
};

export function getDividendMonthlySeries(monthsBack = 12, monthsForward = 12): DividendMonthPoint[] {
  const db = getDb();
  const now = new Date();

  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - monthsBack, 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + monthsForward + 1, 1));

  const rows = db
    .prepare(
      `
      SELECT
        substr(cf.pay_date, 1, 7) AS ym,
        cf.type AS type,
        SUM(cf.amount) AS amount
      FROM cashflows cf
      WHERE cf.pay_date >= ?
        AND cf.pay_date < ?
        AND cf.type IN ('dividend_actual', 'dividend_projected')
      GROUP BY substr(cf.pay_date, 1, 7), cf.type
      ORDER BY ym ASC
    `,
    )
    .all(start.toISOString().slice(0, 10), end.toISOString().slice(0, 10)) as Array<{
    ym: string;
    type: "dividend_actual" | "dividend_projected";
    amount: number;
  }>;

  const map = new Map<string, { actual: number; projected: number }>();
  for (const r of rows) {
    const cur = map.get(r.ym) ?? { actual: 0, projected: 0 };
    if (r.type === "dividend_actual") cur.actual += r.amount;
    else cur.projected += r.amount;
    map.set(r.ym, cur);
  }

  // Fill missing months with zeros
  const out: DividendMonthPoint[] = [];
  const cursor = new Date(start);
  while (cursor < end) {
    const ym = `${cursor.getUTCFullYear()}-${String(cursor.getUTCMonth() + 1).padStart(2, "0")}`;
    const v = map.get(ym) ?? { actual: 0, projected: 0 };
    out.push({ month: ym, actual: v.actual, projected: v.projected });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return out;
}

