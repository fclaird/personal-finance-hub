import { NextResponse } from "next/server";

import { getSecCompanyTickerMap, lookupSecCompanyTitle } from "@/lib/openData/secCompanyTickers";
import { resolveCompanyNamesOpenFigi } from "@/lib/openData/openFigiNames";
import { schwabCompanyNameFromQuoteEntry } from "@/lib/schwab/quoteCompanyName";
import { fetchSchwabQuotesResponse } from "@/lib/schwab/quotesFetch";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

const MAX_SYMBOLS = 120;

export async function POST(req: Request) {
  let body: { symbols?: unknown };
  try {
    body = (await req.json()) as { symbols?: unknown };
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON body" }, { status: 400 });
  }

  const raw = Array.isArray(body.symbols) ? body.symbols : [];
  const symbols = [...new Set(raw.map((s) => normSym(String(s ?? ""))).filter(Boolean))].slice(0, MAX_SYMBOLS);

  const names: Record<string, string | null> = {};

  const quoteResp = await fetchSchwabQuotesResponse(symbols);
  for (const sym of symbols) {
    const entry = quoteResp[sym] ?? quoteResp[sym.toUpperCase()];
    names[sym] = schwabCompanyNameFromQuoteEntry(entry);
  }

  const missingAfterQuotes = symbols.filter((s) => !names[s]);
  if (missingAfterQuotes.length > 0) {
    const openFigi = await resolveCompanyNamesOpenFigi(missingAfterQuotes);
    for (const s of missingAfterQuotes) {
      const hit = openFigi[s]?.trim();
      if (hit) names[s] = hit;
    }
  }

  const stillMissing = symbols.filter((s) => !names[s]);
  if (stillMissing.length > 0) {
    const secMap = await getSecCompanyTickerMap();
    for (const s of stillMissing) {
      const t = lookupSecCompanyTitle(secMap, s);
      if (t) names[s] = t;
    }
  }

  return NextResponse.json({ ok: true, names });
}
