import { NextResponse } from "next/server";

import { buildSymbolNarrative } from "@/lib/symbolStory/symbolNarrative";
import {
  getSymbolNarrativeCacheResponse,
  narrativeToApiPayload,
  revalidateSymbolNarrative,
} from "@/lib/symbolStory/symbolNarrativeService";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "").trim().toUpperCase();
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });

  const mode = (url.searchParams.get("mode") ?? "").trim().toLowerCase();

  try {
    if (mode === "cache") {
      const payload = getSymbolNarrativeCacheResponse(symbol);
      if (!payload.ok) return NextResponse.json(payload, { status: 400 });
      return NextResponse.json(payload);
    }

    if (mode === "revalidate") {
      const { narrative, updated, stale } = await revalidateSymbolNarrative(symbol);
      return NextResponse.json(
        narrativeToApiPayload(narrative, { fromCache: false, stale, updated }),
      );
    }

    // Legacy: full fetch (no stale-while-revalidate) — still used if called without mode.
    const narrative = await buildSymbolNarrative(symbol);
    return NextResponse.json({ ok: true, ...narrative });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 502 },
    );
  }
}
