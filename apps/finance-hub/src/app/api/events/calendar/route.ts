import { NextResponse } from "next/server";

import { buildEventCalendar } from "@/lib/events/eventCalendar";
import { expectedMoveFromChain, type ExpectedMove } from "@/lib/events/expectedMove";
import { earningsForSymbols, exDividendsForSymbols, heldSymbols, openOptions, watchlistSymbols } from "@/lib/events/queries";
import { getDb } from "@/lib/db";
import { latestSnapshotIds, latestSnapshotScopeForMode } from "@/lib/holdings/latestSnapshots";
import { getOptionChain } from "@/lib/optionChain/server";
import { isFinnhubConfigured } from "@/lib/earnings/finnhub";
import { resolveViewScope } from "@/lib/viewScope";

const MOVE_CAP = 8;

function addDays(iso: string, days: number): string {
  const date = new Date(`${iso}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const today = new Date().toISOString().slice(0, 10);
    const days = Math.min(365, Math.max(7, Number(url.searchParams.get("days") ?? "90") || 90));
    const through = addDays(today, days);
    const watchlistId = url.searchParams.get("watchlistId") ?? "";
    const includeMoves = url.searchParams.get("moves") !== "0";
    const { flavor, dataMode } = await resolveViewScope();
    const db = getDb();
    const snapshots = latestSnapshotIds(db, latestSnapshotScopeForMode(dataMode), flavor);
    const held = heldSymbols(db, snapshots);
    const watch = watchlistSymbols(db, watchlistId);
    const symbols = [...new Set([...held, ...watch])].sort((a, b) => a.localeCompare(b));
    const earnings = earningsForSymbols(db, symbols, today, through);
    const exDividends = exDividendsForSymbols(db, symbols, today, through);
    const options = openOptions(db, snapshots);
    const gaps: string[] = [];
    const moves: ExpectedMove[] = [];
    if (symbols.length === 0) {
      gaps.push("No held names or watchlist symbols yet. Earnings and ex-dividend rows stay empty until a universe exists.");
    }
    if (!isFinnhubConfigured() && earnings.length === 0) {
      gaps.push("Finnhub is not configured, and no earnings dates are stored. Set FINNHUB_API_KEY and sync Earnings.");
    }
    if (symbols.length > 0 && exDividends.length === 0) {
      gaps.push("No upcoming ex-dividend dates in local cashflows or dividend fundamentals for these names.");
    }
    if (includeMoves) {
      const capped = symbols.slice(0, MOVE_CAP);
      if (symbols.length > MOVE_CAP) {
        gaps.push(`Expected move uses the first ${MOVE_CAP} symbols so the page does not pull a full chain for every name.`);
      }
      for (const symbol of capped) {
        try {
          const chain = await getOptionChain(symbol);
          if (!chain.ok) {
            gaps.push(`${symbol}: ${chain.error}`);
            continue;
          }
          const move = expectedMoveFromChain(chain.chain);
          if (!move) {
            gaps.push(`${symbol}: the chain has no two-sided at-the-money straddle.`);
            continue;
          }
          moves.push(move);
        } catch (error) {
          gaps.push(`${symbol}: ${error instanceof Error ? error.message : "chain request failed"}`);
        }
      }
    }
    const view = buildEventCalendar({ today, through, symbols, earnings, exDividends, options, moves });
    return NextResponse.json({
      ok: true,
      ...view,
      sources: {
        earnings: "Finnhub calendar stored in earnings_events. The Earnings page syncs it.",
        exDividend: "Local dividend cashflows (ex_date) and saved dividend fundamentals (next_ex_date). Not a live dividend calendar.",
        fomc: "Federal Reserve published FOMC calendar, kept in the app. 2027 dates are tentative.",
        expectedMove:
          "Nearest listed expiry at-the-money straddle: call mid plus put mid, divided by spot. Schwab chain first, Cboe delayed quotes if Schwab has none.",
        positions: "Latest holding snapshots for this flavor. An option is flagged when an event date is on or before its expiry.",
      },
      gaps,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message }, { status: 500 });
  }
}
