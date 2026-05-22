import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { runSchwabRefresh, type SchwabRefreshBundle } from "@/lib/schwab/refreshOrchestrator";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";

function parseBundle(body: unknown): SchwabRefreshBundle {
  if (body && typeof body === "object" && "bundle" in body) {
    const b = (body as { bundle?: unknown }).bundle;
    if (b === "rth" || b === "slow" || b === "closed") return b;
  }
  const reason =
    body && typeof body === "object" && typeof (body as { reason?: unknown }).reason === "string"
      ? (body as { reason: string }).reason
      : "";
  if (reason === "stale_navigation") {
    return "rth";
  }
  return isUsEquityRegularSessionOpen(new Date()) ? "rth" : "closed";
}

export async function POST(req: Request) {
  try {
    let body: unknown = null;
    const ct = req.headers.get("content-type") ?? "";
    if (ct.includes("application/json")) {
      try {
        body = await req.json();
      } catch {
        body = null;
      }
    }
    const bundle = parseBundle(body);
    const reason =
      body && typeof body === "object" && typeof (body as { reason?: unknown }).reason === "string"
        ? (body as { reason: string }).reason
        : "api";

    const result = await runSchwabRefresh(bundle, { reason });
    return NextResponse.json(result);
  } catch (e) {
    logError("schwab_refresh_api_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
