import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { buildBookForwardTimeline } from "@/lib/dividends/buildBookForwardTimeline";
import { captureBookForwardSnap, ensureBookLiveStartedAt } from "@/lib/dividends/bookForwardSnap";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeSpy = url.searchParams.get("includeSpy") === "1" || url.searchParams.get("includeSpy") === "true";
  const includeQqq = url.searchParams.get("includeQqq") === "1" || url.searchParams.get("includeQqq") === "true";

  const db = getDb();
  ensureBookLiveStartedAt(db);

  let { points, liveStartedAt, totalDividendsReceived } = await buildBookForwardTimeline(db, includeSpy, includeQqq);

  if (points.length === 0) {
    await captureBookForwardSnap(db, new Date(), { fetchLiveQuotes: false });
    ({ points, liveStartedAt, totalDividendsReceived } = await buildBookForwardTimeline(db, includeSpy, includeQqq));
  }

  const mapped = points.map((p) => ({
    month_end: p.as_of,
    portfolio_rebased_pct: p.portfolio_rebased_pct,
    price_only_rebased_pct: p.portfolio_rebased_pct,
    total_market_value: p.nav_total,
    total_dividends: p.dividends_period,
    spy_rebased_pct: p.spy_rebased_pct,
    qqq_rebased_pct: p.qqq_rebased_pct,
    status: p.status,
  }));

  const monthsReturned = mapped.length;
  const firstMonthEnd = monthsReturned > 0 ? mapped[0]!.month_end : null;
  const lastMonthEnd = monthsReturned > 0 ? mapped[mapped.length - 1]!.month_end : null;

  return NextResponse.json({
    ok: true,
    mode: "forward_weekly",
    trackingMode: "live",
    liveStartedAt,
    monthsReturned,
    firstMonthEnd,
    lastMonthEnd,
    totalDividendsReceived,
    points: mapped,
    footnote:
      "Live tracking across all Schwab accounts: weekly NAV from current quotes × aggregated dividend-paying holdings. For backtest and modeling tools, use Sim Dividend Portfolio.",
  });
}
