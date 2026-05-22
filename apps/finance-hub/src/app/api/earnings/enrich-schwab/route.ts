import { NextResponse } from "next/server";

/**
 * Reserved for Schwab market-data IV (ATM / vol surface) + 52-week IV band.
 * Storage is ready on `earnings_opp_metrics` (`iv_current`, `iv_52w_high`, `iv_52w_low`, `iv_rank_pct`).
 */
export async function POST() {
  return NextResponse.json({
    ok: true,
    updated: 0,
    skipped: true,
    message:
      "Schwab IV enrichment is not wired yet. After connecting Schwab, we can populate iv_current / iv_52w_* from option chains or vendor vol endpoints and recompute iv_rank_pct + opportunity_score.",
  });
}
