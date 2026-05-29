import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { buildIntradaySparklineSeries } from "@/lib/terminal/terminalSparklines";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

const MAX_SYMBOLS = 300;

/**
 * Batch intraday sparklines for the terminal Quotes watchlist.
 * Uses cached 5m OHLCV for the current NY session day; backfills up to 40 missing
 * symbols from Schwab per request.
 *
 * GET /api/terminal/sparklines?symbols=AAPL,MSFT → { ok, series: { AAPL: number[], ... } }
 */
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const raw = url.searchParams.get("symbols") ?? "";
    const symbols = Array.from(
      new Set(
        raw
          .split(",")
          .map(normSym)
          .filter(Boolean),
      ),
    ).slice(0, MAX_SYMBOLS);

    if (symbols.length === 0) {
      return NextResponse.json({ ok: true, series: {} as Record<string, number[]> });
    }

    const series = await buildIntradaySparklineSeries(symbols);
    return NextResponse.json({ ok: true, series });
  } catch (e) {
    logError("terminal_sparklines_get", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), series: {} },
      { status: 500 },
    );
  }
}
