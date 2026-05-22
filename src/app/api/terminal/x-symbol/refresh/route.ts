import { NextResponse } from "next/server";

import { refreshSymbolPosts } from "@/lib/x/refreshSymbolPosts";

export async function POST(req: Request) {
  let body: { symbol?: string };
  try {
    body = (await req.json()) as { symbol?: string };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const result = await refreshSymbolPosts(body.symbol ?? "");
  if (!result.ok) {
    return NextResponse.json({
      ok: false,
      error: result.error,
      disconnected: result.disconnected ?? false,
    });
  }

  const p = result.payload;
  return NextResponse.json({ ok: true, hasData: true, cached: false, ...p });
}
