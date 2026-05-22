import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { buildAllocationDigest } from "@/lib/allocationDigest";
import { signAllocationReportToken } from "@/lib/allocationReportToken";
import { DATA_MODE_COOKIE, parseDataMode, type DataMode } from "@/lib/dataMode";
import { authorizeCronRequest, getReportSigningSecret } from "@/lib/internalCronAuth";

export async function GET(req: Request) {
  if (!authorizeCronRequest(req)) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(req.url);
  const jar = await cookies();
  const modeFromCookie = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
  const modeParam = url.searchParams.get("mode");
  const mode: DataMode = modeParam === "schwab" || modeParam === "auto" ? modeParam : modeFromCookie;

  if (url.searchParams.get("format") === "jwt") {
    const secret = getReportSigningSecret();
    if (!secret) {
      return NextResponse.json({ ok: false, error: "Missing CRON_SECRET or ALLOC_REPORT_SECRET" }, { status: 500 });
    }
    const ttl = Math.min(Math.max(Number(url.searchParams.get("ttlSec")) || 900, 60), 3600);
    const token = await signAllocationReportToken(secret, ttl, mode);
    return NextResponse.json({ ok: true, token, expiresInSec: ttl, mode });
  }

  return NextResponse.json(buildAllocationDigest(mode));
}
