import { NextResponse } from "next/server";

import { runSchwabGreeksRefresh } from "@/lib/schwab/schwabGreeksRefresh";

export async function POST() {
  const result = await runSchwabGreeksRefresh();
  if (!result.ok) {
    return NextResponse.json(
      { ok: false, error: result.error ?? "Greeks refresh failed" },
      { status: result.error?.includes("No holdings") ? 400 : 500 },
    );
  }
  return NextResponse.json({
    ok: true,
    carryForwardApplied: result.carryForwardApplied,
    updated: result.updated,
    pricesUpdated: result.pricesUpdated,
    message: result.message,
  });
}
