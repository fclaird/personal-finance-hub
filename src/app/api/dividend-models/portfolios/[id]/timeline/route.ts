import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { assertPortfolioExists, buildModeledMonthlyTimeline } from "@/lib/dividendModels/timeline";
import { parseSimulationMode, parseTimelineYears } from "@/lib/dividendModels/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const url = new URL(req.url);
  const years = parseTimelineYears(url.searchParams.get("years"));
  const mode = parseSimulationMode(url.searchParams.get("mode"));
  const includeSpy = url.searchParams.get("includeSpy") === "1" || url.searchParams.get("includeSpy") === "true";
  const includeQqq = url.searchParams.get("includeQqq") === "1" || url.searchParams.get("includeQqq") === "true";

  const db = getDb();
  if (!assertPortfolioExists(db, portfolioId)) {
    return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });
  }

  const { points, totalDividendsReceived } = await buildModeledMonthlyTimeline(db, portfolioId, years, mode, includeSpy, includeQqq);
  const monthsReturned = points.length;
  const firstMonthEnd = monthsReturned > 0 ? points[0]!.month_end : null;
  const lastMonthEnd = monthsReturned > 0 ? points[points.length - 1]!.month_end : null;

  return NextResponse.json({
    ok: true,
    mode: "simulated_monthly",
    simulationMode: mode,
    years,
    monthsReturned,
    firstMonthEnd,
    lastMonthEnd,
    totalDividendsReceived,
    points,
    footnote:
      mode === "reinvest"
        ? "Hypothetical path: fixed starting shares, monthly dividends reinvested at month-end closes weighted by market value (Yahoo dividend history + Schwab OHLCV)."
        : "Hypothetical path: fixed shares, dividends accumulate as cash; NAV is equity at month-end plus cumulative cash (Yahoo dividend history + Schwab OHLCV).",
  });
}
