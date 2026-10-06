import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { bookHoldingsFooter, buildSchwabDividendBook } from "@/lib/dividends/schwabDividendBook";
import { resolveViewScope } from "@/lib/viewScope";

export async function GET() {
  const db = getDb();
  const { flavor } = await resolveViewScope();
  const book = await buildSchwabDividendBook(db, { fetchLiveData: false, flavor });
  const rows = book.dividendRows.map((r) => ({
    symbol: r.symbol,
    displayName: r.displayName,
    accountsLabel: r.accountsLabel,
    shares: r.shares,
    last: r.last,
    divYield: r.divYield,
    annualDivEst: r.annualDivEst,
    marketValue: r.marketValue,
    nextExDate: r.nextExDate,
    sector: r.sector,
    industry: r.industry,
    avgUnitCost: r.avgUnitCost,
    category: r.category,
    cost: r.cost,
  }));
  const footer = bookHoldingsFooter(book.dividendRows);
  return NextResponse.json({ ok: true, rows, footer, snapshotAsOf: book.banner.snapshotAsOf });
}
