import { NextResponse } from "next/server";
import { cookies } from "next/headers";

import { getAllocationByAccount } from "@/lib/analytics/allocation";
import { DATA_MODE_COOKIE, parseDataMode } from "@/lib/dataMode";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const includeSynthetic = url.searchParams.get("synthetic") !== "0";
  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
  const accounts = getAllocationByAccount(includeSynthetic, mode);
  return NextResponse.json({ ok: true, mode, includeSynthetic, accounts });
}

