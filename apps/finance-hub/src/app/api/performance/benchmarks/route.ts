import { NextResponse } from "next/server";

import { ensureBenchmarkHistory, getCachedBenchmarkSeries } from "@/lib/market/benchmarks";
import { normalizeSchwabQuoteSymbol } from "@/lib/market/schwabSymbol";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = (url.searchParams.get("symbols") ?? "SPY,QQQ")
    .split(",")
    .map((s) => normalizeSchwabQuoteSymbol(s))
    .filter(Boolean);

  for (const s of symbols) await ensureBenchmarkHistory(s);

  const series: Record<string, Array<{ date: string; close: number }>> = {};
  for (const s of symbols) series[s] = getCachedBenchmarkSeries(s);

  return NextResponse.json({ ok: true, series });
}

