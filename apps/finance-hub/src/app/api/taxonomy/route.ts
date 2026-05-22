import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export async function GET(req: Request) {
  try {
  const url = new URL(req.url);
  const raw = url.searchParams.get("symbols") ?? "";
  const symbols = Array.from(new Set(raw.split(",").map(normSym).filter(Boolean)));
  if (symbols.length === 0) return NextResponse.json({ ok: true, taxonomy: {} });

  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT symbol, sector, industry, market_cap, market_cap_bucket, revenue_geo_bucket, source, updated_at
      FROM security_taxonomy
      WHERE symbol IN (${symbols.map(() => "?").join(",")})
    `,
    )
    .all(...symbols) as Array<{
    symbol: string;
    sector: string | null;
    industry: string | null;
    market_cap: number | null;
    market_cap_bucket: string | null;
    revenue_geo_bucket: string | null;
    source: string | null;
    updated_at: string;
  }>;

  const out: Record<string, unknown> = {};
  for (const r of rows) {
    out[r.symbol] = {
      sector: r.sector,
      industry: r.industry,
      marketCap: r.market_cap,
      marketCapBucket: r.market_cap_bucket,
      revenueGeoBucket: r.revenue_geo_bucket,
      source: r.source,
      updatedAt: r.updated_at,
    };
  }

  return NextResponse.json({ ok: true, taxonomy: out });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg, taxonomy: {} }, { status: 500 });
  }
}

