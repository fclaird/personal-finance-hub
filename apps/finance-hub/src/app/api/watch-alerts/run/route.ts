import { NextResponse } from "next/server";

import { runWatchAlerts } from "@/lib/alerts/watchAlertStore";
import { pnlBySpread, pnlByUnderlying } from "@/lib/alerts/watchAlerts";
import { latestIvRank, pnlPositions, watchlistSymbols, heldSymbols } from "@/lib/events/queries";
import { getDb } from "@/lib/db";
import { getAlertEvents } from "@/lib/alerts";
import { latestSnapshotIds, latestSnapshotScopeForMode } from "@/lib/holdings/latestSnapshots";
import { parseSchwabNormalizedQuote } from "@/lib/market/parseSchwabNormalizedQuote";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";
import { resolveViewScope } from "@/lib/viewScope";

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const watchlistId = url.searchParams.get("watchlistId") ?? "";
    const { flavor, dataMode } = await resolveViewScope();
    const db = getDb();
    const snapshots = latestSnapshotIds(db, latestSnapshotScopeForMode(dataMode), flavor);
    const symbols = [...new Set([...(watchlistId ? watchlistSymbols(db, watchlistId) : heldSymbols(db, snapshots))])];
    const quotes: Array<{ symbol: string; last: number | null; ivRankPct: number | null }> = [];
    const marks = new Map<string, number | null>();
    const ranks = latestIvRank(db, symbols);
    let quoteNote: string | null = null;
    if (symbols.length > 0) {
      try {
        const raw = await fetchSchwabQuotesResponse(symbols);
        const now = new Date().toISOString();
        for (const symbol of symbols) {
          const parsed = parseSchwabNormalizedQuote(symbol, schwabQuoteObjectFromEntry(raw[symbol] ?? raw[symbol.toUpperCase()]), now);
          quotes.push({ symbol, last: parsed.last, ivRankPct: ranks.get(symbol) ?? null });
          marks.set(symbol, parsed.last);
        }
      } catch (error) {
        const raw = error instanceof Error ? error.message : "Schwab quotes failed.";
        quoteNote = raw.includes("FINANCE_HUB_PASSPHRASE")
          ? "Schwab quotes need an unlocked hub session. Price and IV alerts stayed quiet. Profit targets still use stored position values."
          : raw;
        for (const symbol of symbols) {
          quotes.push({ symbol, last: null, ivRankPct: ranks.get(symbol) ?? null });
          marks.set(symbol, null);
        }
      }
    }
    const positions = pnlPositions(db, snapshots, marks);
    const result = runWatchAlerts(db, quotes, pnlByUnderlying(positions), pnlBySpread(positions));
    const events = getAlertEvents(20).filter((event) => event.rule_type === "watch");
    return NextResponse.json({
      ok: true,
      created: result.created,
      firings: result.firings,
      stored: result.stored,
      events,
      quoteNote,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
