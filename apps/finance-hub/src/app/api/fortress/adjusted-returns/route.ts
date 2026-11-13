import { NextResponse } from "next/server";

import { ADJUSTED_PROVIDER, ADJUSTED_VERSION, CORPORATE_ACTIONS } from "@/lib/market/adjustedClose";
import { loadAdjustedSeries } from "@/lib/market/adjustedCloseCache";
import { yahooChartSymbol } from "@/lib/market/yahooChartFetch";

const SYMBOL = /^[A-Z0-9.^=-]{1,16}$/;

/** Read-only Yahoo adjclose load. Does not write price_points and does not place orders. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbols = [...new Set((url.searchParams.get("symbols") ?? "").split(",").map((symbol) => yahooChartSymbol(symbol)).filter((symbol) => SYMBOL.test(symbol)))];
  const benchmark = yahooChartSymbol(url.searchParams.get("benchmark") ?? "SPY");
  if (!SYMBOL.test(benchmark) || symbols.length === 0 || symbols.length > 12) {
    return NextResponse.json({ ok: false, reason: "Provide 1 to 12 tickers. The benchmark defaults to SPY." }, { status: 400 });
  }
  const series = await loadAdjustedSeries([...symbols, benchmark]);
  return NextResponse.json({
    ok: true,
    provider: ADJUSTED_PROVIDER,
    version: ADJUSTED_VERSION,
    corporateActions: CORPORATE_ACTIONS,
    benchmark,
    series,
    provenance: "Yahoo chart v8 indicators.adjclose, split and dividend adjusted. Not a Schwab raw close. A missing adjclose array is left empty.",
  });
}
