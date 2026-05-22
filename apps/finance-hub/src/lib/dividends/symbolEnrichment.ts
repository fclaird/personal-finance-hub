import type Database from "better-sqlite3";

import { logError } from "@/lib/log";
import { nextDividendCalendarDate } from "@/lib/dividends/cashflows";
import { ensureFundamentalsSnapshotsFresh } from "@/lib/dividends/ensureFundamentals";
import type { EnrichedHoldingRow } from "@/lib/dividends/enrichedHoldings";
import { inferHoldingCategory } from "@/lib/dividends/holdingCategory";
import { fetchSchwabQuotesNormalized } from "@/lib/dividends/dividendModelQuotes";
import { readLatestSymbolMonthlyYield } from "@/lib/dividends/symbolMonthlyMarket";

export type SymbolHoldingBase = {
  holdingId: string;
  symbol: string;
  shares: number | null;
  sortOrder: number;
  avgUnitCost: number | null;
  securityType?: string | null;
  assetType?: string | null;
  /** Schwab snapshot market value when live quotes are skipped. */
  snapshotMarketValue?: number | null;
};

export type EnrichSymbolHoldingsOptions = {
  forceRefetchFundamentals?: boolean;
  /** When false, use cached DB fundamentals and snapshot prices only (no Schwab/Yahoo API). */
  fetchLiveData?: boolean;
};

export async function enrichSymbolHoldings(
  db: Database.Database,
  holdings: SymbolHoldingBase[],
  options?: EnrichSymbolHoldingsOptions,
): Promise<EnrichedHoldingRow[]> {
  const symbols = holdings.map((h) => h.symbol.toUpperCase());
  const fetchLive = options?.fetchLiveData === true;

  if (fetchLive) {
    await ensureFundamentalsSnapshotsFresh(db, symbols, undefined, options?.forceRefetchFundamentals ?? false);
  }

  const today = new Date().toISOString().slice(0, 10);
  const cachedPx = new Map<string, number>();
  if (!fetchLive && symbols.length > 0) {
    const ph = symbols.map(() => "?").join(",");
    const pxRows = db
      .prepare(
        `
        SELECT symbol, close FROM price_points
        WHERE provider = 'schwab' AND date = ? AND UPPER(symbol) IN (${ph})
      `,
      )
      .all(today, ...symbols) as Array<{ symbol: string; close: number }>;
    for (const r of pxRows) {
      if (r.symbol && Number.isFinite(r.close) && r.close > 0) cachedPx.set(r.symbol.toUpperCase(), r.close);
    }
  }

  let quotes: Map<string, { symbol: string; last: number | null; mark: number | null; close: number | null }> = new Map();
  if (fetchLive) {
    try {
      quotes = await fetchSchwabQuotesNormalized(symbols);
    } catch (e) {
      logError("symbol_enrichment_schwab_quotes", e);
    }
  }

  return holdings.map((h) => {
    const sym = h.symbol.toUpperCase();
    const q = quotes.get(sym);
    const quotePx = q?.last ?? q?.mark ?? q?.close;
    const snap = db
      .prepare(
        `
        SELECT display_name AS displayNameCol, div_yield AS divYield, annual_div_est AS annualDivEst, next_ex_date AS nextExFromSnap, raw_json AS rawJson
        FROM dividend_model_symbol_fundamentals_snap
        WHERE symbol = ?
        ORDER BY captured_at DESC
        LIMIT 1
      `,
      )
      .get(sym) as
      | {
          displayNameCol: string | null;
          divYield: number | null;
          annualDivEst: number | null;
          nextExFromSnap: string | null;
          rawJson: string | null;
        }
      | undefined;

    let industry: string | null = null;
    let displayName: string | null = snap?.displayNameCol?.trim() || null;
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

    const snapPx =
      h.snapshotMarketValue != null &&
      h.shares != null &&
      h.shares > 0 &&
      Number.isFinite(h.snapshotMarketValue) &&
      Number.isFinite(h.shares)
        ? h.snapshotMarketValue / h.shares
        : null;
    const cachedClose = cachedPx.get(sym) ?? null;
    const px =
      quotePx != null && Number.isFinite(quotePx) && quotePx > 0
        ? quotePx
        : cachedClose != null && cachedClose > 0
          ? cachedClose
          : snapPx != null && snapPx > 0
            ? snapPx
            : h.avgUnitCost != null && h.avgUnitCost > 0
              ? h.avgUnitCost
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
      h.shares != null && px != null && Number.isFinite(h.shares) && Number.isFinite(px)
        ? h.shares * px
        : h.snapshotMarketValue != null && Number.isFinite(h.snapshotMarketValue)
          ? h.snapshotMarketValue
          : null;

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
      holdingId: h.holdingId,
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
      category: inferHoldingCategory(sym, sector, industry, {
        securityType: h.securityType,
        assetType: h.assetType,
      }),
      cost,
    };
  });
}
