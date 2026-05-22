import type Database from "better-sqlite3";

import { nyCalendarIso } from "@/lib/analytics/allocationNyDate";
import type { DataMode } from "@/lib/dataMode";

export type AllocationHistoryBucket = "net" | "brokerage" | "retirement";
export type AllocationHistoryMetric = "net" | "spot" | "synthetic";

export type AllocationHistoryPoint = { date: string; pct: number };

export type AllocationHistorySeries = { symbol: string; points: AllocationHistoryPoint[] };

const TOP_N = 12;

function metricSlice(spot: number, synthetic: number, metric: AllocationHistoryMetric): number {
  switch (metric) {
    case "spot":
      return spot;
    case "synthetic":
      return synthetic;
    case "net":
      return spot + synthetic;
    default:
      return 0;
  }
}

function nyCutoffIso(days: number): string {
  const t = Date.now() - Math.max(1, Math.min(730, days)) * 86400000;
  return nyCalendarIso(new Date(t));
}

type AllocDailyRow = {
  d: string;
  s: string;
  spot: number;
  syn: number;
};

/**
 * Read daily allocation rows and return line-chart series (top symbols + Other by weight on latest date).
 */
export function queryAllocationUnderlyingHistory(
  db: Database.Database,
  params: {
    mode: DataMode;
    bucket: AllocationHistoryBucket;
    metric: AllocationHistoryMetric;
    days: number;
  },
): { dates: string[]; series: AllocationHistorySeries[] } {
  const cutoff = nyCutoffIso(params.days);
  const stmt = db.prepare(
    `
      SELECT trade_date AS d, symbol AS s, spot_market_value AS spot, synthetic_market_value AS syn
      FROM allocation_daily_underlying
      WHERE data_mode = @mode AND scope = @bucket AND trade_date >= @cutoff
      ORDER BY trade_date ASC, symbol ASC
    `,
  );
  const rows = stmt.all({ mode: params.mode, bucket: params.bucket, cutoff }) as AllocDailyRow[];

  const byDate = new Map<string, Map<string, { spot: number; syn: number }>>();
  for (const r of rows) {
    const sym = (r.s ?? "").trim().toUpperCase();
    if (!sym) continue;
    let m = byDate.get(r.d);
    if (!m) {
      m = new Map();
      byDate.set(r.d, m);
    }
    m.set(sym, { spot: r.spot, syn: r.syn });
  }

  const dates = [...byDate.keys()].sort();
  if (dates.length === 0) return { dates: [], series: [] };

  const latest = dates[dates.length - 1]!;
  const latestMap = byDate.get(latest)!;
  const totalsLatest = new Map<string, number>();
  for (const [sym, v] of latestMap) {
    totalsLatest.set(sym, metricSlice(v.spot, v.syn, params.metric));
  }
  const ranked = [...totalsLatest.entries()]
    .filter(([, mv]) => mv > 1e-9)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([sym]) => sym);
  const top = new Set(ranked.slice(0, TOP_N));

  const seriesSymbols = [...top];
  if (ranked.length > TOP_N) seriesSymbols.push("__OTHER__");

  const series: AllocationHistorySeries[] = seriesSymbols.map((sym) => ({
    symbol: sym === "__OTHER__" ? "Other" : sym,
    points: dates.map((d) => ({ date: d, pct: 0 })),
  }));
  const symIndex = new Map(seriesSymbols.map((s, i) => [s, i] as const));

  for (let di = 0; di < dates.length; di++) {
    const d = dates[di]!;
    const m = byDate.get(d);
    if (!m) continue;
    let total = 0;
    const sliceBySym = new Map<string, number>();
    for (const [sym, v] of m) {
      const sl = metricSlice(v.spot, v.syn, params.metric);
      sliceBySym.set(sym, sl);
      total += sl;
    }
    if (total <= 1e-9) continue;
    let otherSum = 0;
    for (const [sym, sl] of sliceBySym) {
      const pct = (sl / total) * 100;
      if (top.has(sym)) {
        const idx = symIndex.get(sym);
        if (idx != null) series[idx]!.points[di]!.pct = pct;
      } else {
        otherSum += pct;
      }
    }
    if (ranked.length > TOP_N) {
      const oi = symIndex.get("__OTHER__");
      if (oi != null) series[oi]!.points[di]!.pct = otherSum;
    }
  }

  return { dates, series };
}
