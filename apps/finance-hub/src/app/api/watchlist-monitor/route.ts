import { NextResponse } from "next/server";

import { assembleMonitorRows } from "@/lib/alerts/watchMonitor";
import { listWatchAlerts } from "@/lib/alerts/watchAlertStore";
import { pnlBySpread, pnlByUnderlying } from "@/lib/alerts/watchAlerts";
import { expectedMoveFromChain } from "@/lib/events/expectedMove";
import { heldSymbols, latestIvRank, pnlPositions, watchlistSymbols } from "@/lib/events/queries";
import { getDb } from "@/lib/db";
import { latestSnapshotIds, latestSnapshotScopeForMode } from "@/lib/holdings/latestSnapshots";
import { parseSchwabNormalizedQuote } from "@/lib/market/parseSchwabNormalizedQuote";
import { getOptionChain } from "@/lib/optionChain/server";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";
import { resolveViewScope } from "@/lib/viewScope";

const IV_CAP = 8;

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const watchlistId = url.searchParams.get("watchlistId") ?? "";
    const withAtmIv = url.searchParams.get("atmIv") === "1";
    const { flavor, dataMode } = await resolveViewScope();
    const db = getDb();
    const snapshots = latestSnapshotIds(db, latestSnapshotScopeForMode(dataMode), flavor);
    const symbols = watchlistId ? watchlistSymbols(db, watchlistId) : heldSymbols(db, snapshots);
    const gaps: string[] = [];
    if (symbols.length === 0) {
      gaps.push(watchlistId ? "That watchlist has no symbols." : "No held names in the latest snapshots. Pick a watchlist or sync positions.");
    }
    const quotes: Array<{ symbol: string; last: number | null; change: number | null; changePercent: number | null; volume: number | null }> = [];
    const quoteMarks = new Map<string, number | null>();
    if (symbols.length > 0) {
      try {
        const raw = await fetchSchwabQuotesResponse(symbols);
        const now = new Date().toISOString();
        for (const symbol of symbols) {
          const parsed = parseSchwabNormalizedQuote(symbol, schwabQuoteObjectFromEntry(raw[symbol] ?? raw[symbol.toUpperCase()]), now);
          quotes.push({
            symbol,
            last: parsed.last,
            change: parsed.change,
            changePercent: parsed.changePercent,
            volume: parsed.volume,
          });
          quoteMarks.set(symbol, parsed.last);
          if (parsed.last == null) gaps.push(`${symbol}: Schwab did not return a price. This board does not fall back to Yahoo.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Schwab quotes failed.";
        gaps.push(
          message.includes("FINANCE_HUB_PASSPHRASE")
            ? "Schwab quotes need an unlocked hub session. This board does not fall back to Yahoo, so last, change, and volume stay blank."
            : message,
        );
        for (const symbol of symbols) {
          quotes.push({ symbol, last: null, change: null, changePercent: null, volume: null });
          quoteMarks.set(symbol, null);
        }
      }
    }
    const ranks = latestIvRank(db, symbols);
    if (symbols.length > 0 && [...ranks.values()].length === 0) {
      gaps.push("IV rank is blank. Schwab IV enrichment is not wired, so earnings metrics have no 52-week IV band yet.");
    }
    const atm = new Map<string, number | null>();
    if (withAtmIv) {
      for (const symbol of symbols.slice(0, IV_CAP)) {
        try {
          const chain = await getOptionChain(symbol);
          if (!chain.ok) continue;
          const move = expectedMoveFromChain(chain.chain);
          if (move?.atmIv != null) atm.set(symbol, move.atmIv);
        } catch {
          // Expected-move gaps are reported on the Events page. The board still shows the quote.
        }
      }
    }
    const rows = assembleMonitorRows(symbols, quotes, ranks, atm);
    const positions = pnlPositions(db, snapshots, quoteMarks);
    const pnls = pnlByUnderlying(positions);
    const spreads = pnlBySpread(positions);
    return NextResponse.json({
      ok: true,
      rows,
      pnls,
      spreads,
      alerts: listWatchAlerts(db),
      sources: {
        quotes: "Schwab /quotes (last, day change, volume). No Yahoo fallback on this board.",
        ivRank: "Stored earnings_opp_metrics.iv_rank_pct (0–100). The Schwab IV enrich route is still a stub.",
        atmIv: "Optional. Average feed IV of the nearest-expiry ATM straddle from the Schwab chain, Cboe if Schwab has none. This is not IV rank.",
        pnl: "Open positions in the latest snapshots. Equity uses the live quote minus average price. A spread is the option legs that share an underlying and an expiry, marked from average price and position market value.",
      },
      gaps,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message, rows: [] }, { status: 500 });
  }
}
