import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { buildForwardTimeline } from "@/lib/dividendModels/buildForwardTimeline";
import { captureForwardSnapForPortfolio } from "@/lib/dividendModels/forwardSnap";
import { assertPortfolioExists, buildModeledMonthlyTimeline } from "@/lib/dividendModels/timeline";
import { parseSimulationMode, parseTimelineYears, parseTrackingMode } from "@/lib/dividendModels/types";

type Ctx = { params: Promise<{ id: string }> };

export async function GET(req: Request, ctx: Ctx) {
  const { id: portfolioId } = await ctx.params;
  const url = new URL(req.url);
  const years = parseTimelineYears(url.searchParams.get("years"));
  const mode = parseSimulationMode(url.searchParams.get("mode"));
  const trackingMode = parseTrackingMode(url.searchParams.get("trackingMode"));
  const includeSpy = url.searchParams.get("includeSpy") === "1" || url.searchParams.get("includeSpy") === "true";
  const includeQqq = url.searchParams.get("includeQqq") === "1" || url.searchParams.get("includeQqq") === "true";

  const db = getDb();
  if (!assertPortfolioExists(db, portfolioId)) {
    return NextResponse.json({ ok: false, error: "Portfolio not found" }, { status: 404 });
  }

  if (trackingMode === "live") {
    let { points, liveStartedAt, totalDividendsReceived } = await buildForwardTimeline(
      db,
      portfolioId,
      includeSpy,
      includeQqq,
    );
    if (points.length === 0 && liveStartedAt) {
      await captureForwardSnapForPortfolio(db, portfolioId);
      ({ points, liveStartedAt, totalDividendsReceived } = await buildForwardTimeline(
        db,
        portfolioId,
        includeSpy,
        includeQqq,
      ));
    }
    const mapped = points.map((p) => ({
      month_end: p.as_of,
      portfolio_rebased_pct: p.portfolio_rebased_pct,
      /** Live NAV is quote × shares (no dividend cash); same series for price-only view. */
      price_only_rebased_pct: p.portfolio_rebased_pct,
      total_market_value: p.nav_total,
      total_dividends: p.dividends_period,
      spy_rebased_pct: p.spy_rebased_pct,
      qqq_rebased_pct: p.qqq_rebased_pct,
      status: p.status,
    }));
    return NextResponse.json({
      ok: true,
      mode: "forward_weekly",
      trackingMode: "live",
      simulationMode: mode,
      liveStartedAt,
      monthsReturned: mapped.length,
      firstMonthEnd: mapped[0]?.month_end ?? null,
      lastMonthEnd: mapped[mapped.length - 1]?.month_end ?? null,
      totalDividendsReceived,
      points: mapped,
      footnote:
        "Live tracking from your portfolio live start date: weekly NAV from current Schwab quotes × shares; dividends from stored payment history since live start. Purchase price does not affect this path.",
    });
  }

  const { points, totalDividendsReceived, missingSynthetic } = await buildModeledMonthlyTimeline(
    db,
    portfolioId,
    years,
    mode,
    includeSpy,
    includeQqq,
  );
  const monthsReturned = points.length;
  const firstMonthEnd = monthsReturned > 0 ? points[0]!.month_end : null;
  const lastMonthEnd = monthsReturned > 0 ? points[points.length - 1]!.month_end : null;

  const syntheticFootnote =
    "Backtest uses stored synthetic share counts: target NAV at window start is $20k (alpha), $100k (bravo), or $200k (charlie), allocated by today's market-value mix and window-start prices. Real holdings are unchanged.";

  if (missingSynthetic) {
    return NextResponse.json({
      ok: true,
      mode: "simulated_monthly",
      trackingMode: "backtest",
      simulationMode: mode,
      years,
      monthsReturned: 0,
      firstMonthEnd: null,
      lastMonthEnd: null,
      totalDividendsReceived: 0,
      points: [],
      footnote: "Build history to compute synthetic backtest shares for this window. " + syntheticFootnote,
    });
  }

  return NextResponse.json({
    ok: true,
    mode: "simulated_monthly",
    trackingMode: "backtest",
    simulationMode: mode,
    years,
    monthsReturned,
    firstMonthEnd,
    lastMonthEnd,
    totalDividendsReceived,
    points,
    footnote:
      (mode === "reinvest"
        ? "Dividends Reinvest: each dividend buys fractional shares at the pay-date close (DRIP); NAV is DRIP-adjusted synthetic shares × month-end close. "
        : "Dividends: synthetic shares fixed; dividends accumulated as cash; NAV is equity at month-end plus cumulative cash. ") +
      syntheticFootnote,
  });
}
