import { NextResponse } from "next/server";

import { resolveCompanyNamesOpenFigi } from "@/lib/openData/openFigiNames";
import { getSecCompanyTickerMap, lookupSecCompanyTitle } from "@/lib/openData/secCompanyTickers";
import { fetchEnrichedCompanyProfile } from "@/lib/schwab/companyProfile";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

function emptyPayload(symbol: string, companyName: string | null, companyNameSource: "schwab" | "openfigi" | "sec" | null): object {
  return {
    ok: true,
    symbol,
    companyName,
    companyNameSource,
    sector: null,
    industry: null,
    marketCap: null,
    pe: null,
    divYield: null,
    beta: null,
    week52High: null,
    week52Low: null,
    avgVol: null,
    sessionHigh: null,
    sessionLow: null,
    raw: {},
  };
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = normSym(url.searchParams.get("symbol") ?? "");
  if (!symbol) return NextResponse.json({ ok: false, error: "Missing symbol" }, { status: 400 });

  let r: Awaited<ReturnType<typeof fetchEnrichedCompanyProfile>>;
  try {
    r = await fetchEnrichedCompanyProfile(symbol);
  } catch (e) {
    let companyName: string | null = null;
    let companyNameSource: "openfigi" | "sec" | null = null;
    const figi = await resolveCompanyNamesOpenFigi([symbol]);
    const fromFigi = figi[symbol]?.trim();
    if (fromFigi) {
      companyName = fromFigi;
      companyNameSource = "openfigi";
    } else {
      const secMap = await getSecCompanyTickerMap();
      const fromSec = lookupSecCompanyTitle(secMap, symbol);
      if (fromSec) {
        companyName = fromSec;
        companyNameSource = "sec";
      }
    }
    return NextResponse.json({
      ...emptyPayload(symbol, companyName, companyNameSource),
      schwabError: e instanceof Error ? e.message : String(e),
    });
  }

  let companyName = r.companyName?.trim() || null;
  let companyNameSource: "schwab" | "openfigi" | "sec" | null = companyName ? "schwab" : null;

  if (!companyName) {
    const figi = await resolveCompanyNamesOpenFigi([symbol]);
    const fromFigi = figi[symbol]?.trim();
    if (fromFigi) {
      companyName = fromFigi;
      companyNameSource = "openfigi";
    }
  }

  if (!companyName) {
    const secMap = await getSecCompanyTickerMap();
    const fromSec = lookupSecCompanyTitle(secMap, symbol);
    if (fromSec) {
      companyName = fromSec;
      companyNameSource = "sec";
    }
  }

  return NextResponse.json(
    {
    ok: true,
    symbol: r.symbol,
    companyName,
    companyNameSource,
    sector: r.sector,
    industry: r.industry,
    marketCap: r.marketCap,
    pe: r.pe,
    divYield: r.divYield,
    beta: r.beta,
    week52High: r.week52High,
    week52Low: r.week52Low,
    avgVol: r.avgVol,
    sessionHigh: r.sessionHigh,
    sessionLow: r.sessionLow,
    raw: r.raw,
  },
    { headers: { "Cache-Control": "no-store, max-age=0" } },
  );
}
