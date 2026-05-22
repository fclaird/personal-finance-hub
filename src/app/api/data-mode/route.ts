import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { DATA_MODE_COOKIE, type DataMode, parseDataMode } from "@/lib/dataMode";
import { getDb } from "@/lib/db";
import { snapshotAvailability } from "@/lib/snapshots";

export async function GET() {
  const db = getDb();
  const avail = snapshotAvailability(db);
  const jar = await cookies();
  const mode = parseDataMode(jar.get(DATA_MODE_COOKIE)?.value);
  return NextResponse.json({
    ok: true,
    mode,
    availability: avail,
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { mode?: unknown } | null;
  const mode: DataMode = parseDataMode(body?.mode);

  const jar = await cookies();
  jar.set(DATA_MODE_COOKIE, mode, {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 3600,
  });

  return NextResponse.json({ ok: true, mode });
}

