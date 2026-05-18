import type Database from "better-sqlite3";

import { logError } from "@/lib/log";
import { ensureFundamentalsSnapshotsFresh } from "@/lib/dividendModels/ensureFundamentals";
import { inferHoldingCategory } from "@/lib/dividendModels/holdingCategory";
import { fetchSchwabQuotesNormalized } from "@/lib/dividendModels/quotes";
import { nextDividendCalendarDate } from "@/lib/dividendModels/cashflows";
import { readLatestSymbolMonthlyYield } from "@/lib/dividendModels/symbolMonthlyMarket";

export type LoadEnrichedHoldingsOptions = {
  /** Re-run Schwab/Yahoo fundamentals for every holding symbol (use after fixing Connections or bad snapshots). */
  forceRefetchFundamentals?: boolean;
};

export type EnrichedHoldingRow = {
  holdingId: string;
  symbol: string;
  displayName: string | null;
  shares: number | null;
  sortOrder: number;
  last: number | null;
  divYield: number | null;
  annualDivEst: number | null;
  marketValue: number | null;
  nextExDate: string | null;
  sector: string | null;
  industry: string | null;
  avgUnitCost: number | null;
  category: string;
  cost: number | null;
};

export async function loadEnrichedHoldings(
  db: Database.Database,
  portfolioId: string,
  options?: LoadEnrichedHoldingsOptions,
): Promise<EnrichedHoldingRow[]> {
  const holdings = db
    .prepare(
      `
      SELECT id, symbol, shares, sort_order AS sortOrder, avg_unit_cost AS avgUnitCost
      FROM dividend_model_holdings
      WHERE portfolio_id = ?
      ORDER BY sort_order ASC, symbol ASC
    `,
    )
    .all(portfolioId) as Array<{
    id: string;
    symbol: string;
    shares: number | null;
    sortOrder: number;
    avgUnitCost: number | null;
  }>;

  const symbols = holdings.map((h) => h.symbol.toUpperCase());
  await ensureFundamentalsSnapshotsFresh(db, symbols, undefined, options?.forceRefetchFundamentals ?? false);

  let quotes: Map<string, { symbol: string; last: number | null; mark: number | null; close: number | null }> = new Map();
  try {
    quotes = await fetchSchwabQuotesNormalized(symbols);
  } catch (e) {
    logError("dividend_model_holdings_schwab_quotes", e);
  }

  const today = new Date().toISOString().slice(0, 10);

  return holdings.map((h) => {
    const sym = h.symbol.toUpperCase();
    const q = quotes.get(sym);
    const quotePx = q?.last ?? q?.mark ?? q?.close;
    const snap = db
      .prepare(
        `
        SELECT div_yield AS divYield, annual_div_est AS annualDivEst, next_ex_date AS nextExFromSnap, raw_json AS rawJson
        FROM dividend_model_symbol_fundamentals_snap
        WHERE symbol = ?
        ORDER BY captured_at DESC
        LIMIT 1
      `,
      )
      .get(sym) as
      | {
          divYield: number | null;
          annualDivEst: number | null;
          nextExFromSnap: string | null;
          rawJson: string | null;
        }
      | undefined;

    let industry: string | null = null;
    let displayName: string | null = null;
    let yahooChartPrice: number | null = null;
    if (snap?.rawJson) {
      try {
        const j = JSON.parse(snap.rawJson) as {
          companyName?: string;
          industry?: string;
          yahooChartPrice?: number;
          schwab?: { industry?: string; companyName?: string };
          yahoo?: { longName?: string; meta?: { longName?: string } };
        };
        industry =
          typeof j.industry === "string"
            ? j.industry
            : typeof j.schwab?.industry === "string"
              ? j.schwab.industry
              : null;
        const cn =
          typeof j.companyName === "string"
            ? j.companyName
            : typeof j.schwab?.companyName === "string"
              ? j.schwab.companyName
              : null;
        if (cn?.trim()) displayName = cn.trim();
        if (typeof j.yahooChartPrice === "number" && Number.isFinite(j.yahooChartPrice) && j.yahooChartPrice > 0) {
          yahooChartPrice = j.yahooChartPrice;
        }
        if (!displayName && j.yahoo && typeof j.yahoo === "object") {
          const yl =
            typeof j.yahoo.longName === "string" && j.yahoo.longName.trim()
              ? j.yahoo.longName.trim()
              : typeof j.yahoo.meta?.longName === "string" && j.yahoo.meta.longName.trim()
                ? j.yahoo.meta.longName.trim()
                : null;
          if (yl) displayName = yl;
        }
      } catch {
        /* ignore */
      }
    }

    const px =
      quotePx != null && Number.isFinite(quotePx) && quotePx > 0
        ? quotePx
        : yahooChartPrice != null && Number.isFinite(yahooChartPrice) && yahooChartPrice > 0
          ? yahooChartPrice
          : null;

    let divYield = snap?.divYield ?? null;
    let annualDivEst = snap?.annualDivEst ?? null;
    if (annualDivEst == null && divYield != null && px != null && px > 0 && Number.isFinite(divYield)) {
      annualDivEst = px * divYield;
    }
    if (divYield == null && annualDivEst != null && px != null && px > 0 && Number.isFinite(annualDivEst)) {
      divYield = annualDivEst / px;
    }

    const tax = db.prepare(`SELECT sector FROM security_taxonomy WHERE symbol = ?`).get(sym) as { sector: string | null } | undefined;
    const sector = tax?.sector ?? null;

    if ((divYield == null || annualDivEst == null) && px != null && px > 0) {
      const ttmYieldPct = readLatestSymbolMonthlyYield(db, sym);
      if (ttmYieldPct != null) {
        if (divYield == null) divYield = ttmYieldPct / 100;
        if (annualDivEst == null) annualDivEst = (ttmYieldPct / 100) * px;
      }
    }

    const mv =
      h.shares != null && px != null && Number.isFinite(h.shares) && Number.isFinite(px) ? h.shares * px : null;

    const cost =
      h.shares != null &&
      h.avgUnitCost != null &&
      Number.isFinite(h.shares) &&
      Number.isFinite(h.avgUnitCost) &&
      h.shares > 0 &&
      h.avgUnitCost > 0
        ? h.shares * h.avgUnitCost
        : null;

    return {
      holdingId: h.id,
      symbol: sym,
      displayName,
      shares: h.shares,
      sortOrder: h.sortOrder,
      last: px ?? null,
      divYield,
      annualDivEst,
      marketValue: mv,
      nextExDate: nextDividendCalendarDate(db, sym, today) ?? snap?.nextExFromSnap ?? null,
      sector,
      industry,
      avgUnitCost: h.avgUnitCost,
      category: inferHoldingCategory(sym, sector, industry),
      cost,
    };
  });
}

export function computeFooterTotals(rows: EnrichedHoldingRow[]) {
  let totalShares = 0;
  let totalMv = 0;
  let totalAnnualDiv = 0;
  let yieldNum = 0;
  for (const r of rows) {
    if (r.shares != null && Number.isFinite(r.shares)) totalShares += r.shares;
    if (r.marketValue != null && Number.isFinite(r.marketValue)) totalMv += r.marketValue;
    if (r.annualDivEst != null && r.shares != null && Number.isFinite(r.annualDivEst) && Number.isFinite(r.shares) && r.shares > 0) {
      totalAnnualDiv += r.annualDivEst * r.shares;
    }
    const px =
      r.last ??
      (r.shares != null && r.shares > 0 && r.marketValue != null && r.marketValue > 0 ? r.marketValue / r.shares : null);
    const impliedYield =
      r.divYield != null && Number.isFinite(r.divYield) && r.divYield >= 0
        ? r.divYield
        : px != null && px > 0 && r.annualDivEst != null && Number.isFinite(r.annualDivEst) && r.annualDivEst >= 0
          ? r.annualDivEst / px
          : null;
    if (impliedYield != null && r.marketValue != null && r.marketValue > 0 && Number.isFinite(impliedYield)) {
      yieldNum += impliedYield * r.marketValue;
    }
  }
  let portfolioYieldPct = totalMv > 0 && yieldNum > 0 ? (yieldNum / totalMv) * 100 : null;
  if (portfolioYieldPct == null && totalMv > 0 && totalAnnualDiv > 0) {
    portfolioYieldPct = (totalAnnualDiv / totalMv) * 100;
  }
  return {
    totalShares,
    totalMv,
    totalAnnualDiv,
    portfolioYieldPct,
  };
}
