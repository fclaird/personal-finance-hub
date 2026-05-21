import { NextResponse } from "next/server";

import { resolveIssuerIdentity } from "@/lib/openData/resolveIssuerIdentity";
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
    const identity = await resolveIssuerIdentity(symbol);
    return NextResponse.json({
      ...emptyPayload(symbol, identity.displayName, identity.nameSource),
      schwabError: e instanceof Error ? e.message : String(e),
    });
  }

  const identity = await resolveIssuerIdentity(symbol, { schwabCompanyName: r.companyName });
  const companyName = identity.displayName ?? r.companyName?.trim() ?? null;
  const companyNameSource: "schwab" | "openfigi" | "sec" | null = identity.displayName
    ? identity.nameSource ?? (r.companyName ? "schwab" : null)
    : null;

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
