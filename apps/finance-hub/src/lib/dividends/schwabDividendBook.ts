import type Database from "better-sqlite3";

import {
  buildPortfolioDashboard,
  fetchDividendCashflowsForSymbols,
  type PortfolioDashboard,
} from "@/lib/dividends/portfolioDashboard";
import { holdingRowIsDividendProducer } from "@/lib/dividends/dividendProducingFilter";
import { computeFooterTotals, type EnrichedHoldingRow } from "@/lib/dividends/enrichedHoldings";
import { inferHoldingCategory, isSchwabFundLike } from "@/lib/dividends/holdingCategory";
import { enrichSymbolHoldings } from "@/lib/dividends/symbolEnrichment";
import { allSyncedAccountsWhereSql } from "@/lib/holdings/latestSnapshots";

import { parseSchwabAssetType } from "./schwabPositionMeta";

export type RawSchwabPositionRow = {
  positionId: string;
  accountId: string;
  accountLabel: string;
  symbol: string;
  shares: number;
  avgUnitCost: number | null;
  snapshotMarketValue: number | null;
  snapshotAsOf: string;
  securityType: string;
  assetType: string | null;
};

export type BuildSchwabDividendBookOptions = {
  forceRefetchFundamentals?: boolean;
  /** When false (default page load), use cached fundamentals and snapshot prices only. */
  fetchLiveData?: boolean;
};

export type SchwabDividendBookRow = EnrichedHoldingRow & {
  accountsLabel: string;
  accountIds: string[];
};

export type DividendBookBanner = {
  totalEquityMarketValue: number;
  dividendMarketValue: number;
  dividendShareOfBookPct: number | null;
  combinedBookYieldPct: number | null;
  dividendSliceYieldPct: number | null;
  dividendSymbolCount: number;
  totalEquitySymbolCount: number;
  snapshotAsOf: string | null;
};

export type SchwabDividendBook = {
  banner: DividendBookBanner;
  dividendRows: SchwabDividendBookRow[];
  allEquityRows: EnrichedHoldingRow[];
};

function accountDisplayLabel(nickname: string | null, name: string): string {
  const n = nickname?.trim();
  return n && n.length > 0 ? n : name;
}

export function loadLatestSchwabPositionRows(db: Database.Database): RawSchwabPositionRow[] {
  const rows = db
    .prepare(
      `
      SELECT
        p.id AS positionId,
        a.id AS accountId,
        a.nickname AS nickname,
        a.name AS accountName,
        UPPER(s.symbol) AS symbol,
        p.quantity AS quantity,
        p.price AS price,
        p.market_value AS marketValue,
        hs.as_of AS snapshotAsOf,
        s.security_type AS securityType,
        p.metadata_json AS metadataJson
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities s ON s.id = p.security_id
      WHERE a.id LIKE 'schwab_%'
        AND ${allSyncedAccountsWhereSql("a")}
        AND s.security_type NOT IN ('cash', 'option')
        AND p.quantity > 0
        AND s.symbol IS NOT NULL
        AND TRIM(s.symbol) != ''
        AND hs.as_of = (
          SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
        )
      ORDER BY symbol ASC, a.name ASC
    `,
    )
    .all() as Array<{
    positionId: string;
    accountId: string;
    nickname: string | null;
    accountName: string;
    symbol: string;
    quantity: number;
    price: number | null;
    marketValue: number | null;
    snapshotAsOf: string;
    securityType: string;
    metadataJson: string | null;
  }>;

  return rows.map((r) => ({
    positionId: r.positionId,
    accountId: r.accountId,
    accountLabel: accountDisplayLabel(r.nickname, r.accountName),
    symbol: r.symbol,
    shares: r.quantity,
    avgUnitCost:
      r.price != null && Number.isFinite(r.price) && r.price > 0
        ? r.price
        : r.marketValue != null && r.quantity > 0 && Number.isFinite(r.marketValue)
          ? r.marketValue / r.quantity
          : null,
    snapshotMarketValue: r.marketValue != null && Number.isFinite(r.marketValue) ? r.marketValue : null,
    snapshotAsOf: r.snapshotAsOf,
    securityType: r.securityType,
    assetType: parseSchwabAssetType(r.metadataJson),
  }));
}

type AggregatedRaw = {
  symbol: string;
  shares: number;
  avgUnitCost: number | null;
  snapshotMarketValue: number;
  accountLabels: string[];
  accountIds: string[];
  securityType: string;
  assetType: string | null;
};

export function aggregateBySymbol(rows: RawSchwabPositionRow[]): AggregatedRaw[] {
  const bySym = new Map<string, AggregatedRaw>();
  for (const r of rows) {
    const sym = r.symbol.toUpperCase();
    let agg = bySym.get(sym);
    if (!agg) {
      agg = {
        symbol: sym,
        shares: 0,
        avgUnitCost: null,
        snapshotMarketValue: 0,
        accountLabels: [],
        accountIds: [],
        securityType: r.securityType,
        assetType: r.assetType,
      };
      bySym.set(sym, agg);
    }
    agg.shares += r.shares;
    if (isSchwabFundLike(r.securityType, r.assetType)) {
      agg.securityType = r.securityType;
      agg.assetType = r.assetType;
    }
    if (r.snapshotMarketValue != null && Number.isFinite(r.snapshotMarketValue)) {
      agg.snapshotMarketValue += r.snapshotMarketValue;
    }
    if (!agg.accountIds.includes(r.accountId)) {
      agg.accountIds.push(r.accountId);
      agg.accountLabels.push(r.accountLabel);
    }
  }

  for (const agg of bySym.values()) {
    let costSum = 0;
    let qtySum = 0;
    for (const r of rows) {
      if (r.symbol.toUpperCase() !== agg.symbol) continue;
      if (r.avgUnitCost != null && Number.isFinite(r.avgUnitCost) && r.avgUnitCost > 0) {
        costSum += r.shares * r.avgUnitCost;
        qtySum += r.shares;
      }
    }
    agg.avgUnitCost = qtySum > 0 && costSum > 0 ? costSum / qtySum : null;
  }

  return [...bySym.values()].sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function weightedYieldPct(rows: EnrichedHoldingRow[]): number | null {
  let yieldNum = 0;
  let totalMv = 0;
  for (const r of rows) {
    const mv = r.marketValue ?? 0;
    if (!(mv > 0)) continue;
    const px =
      r.last ??
      (r.shares != null && r.shares > 0 && r.marketValue != null && r.marketValue > 0 ? r.marketValue / r.shares : null);
    const impliedYield =
      r.divYield != null && Number.isFinite(r.divYield) && r.divYield >= 0
        ? r.divYield
        : px != null && px > 0 && r.annualDivEst != null && Number.isFinite(r.annualDivEst) && r.annualDivEst >= 0
          ? r.annualDivEst / px
          : null;
    if (impliedYield != null && Number.isFinite(impliedYield)) {
      yieldNum += impliedYield * mv;
      totalMv += mv;
    }
  }
  if (totalMv > 0 && yieldNum > 0) return (yieldNum / totalMv) * 100;
  let totalAnnualDiv = 0;
  for (const r of rows) {
    if (r.annualDivEst != null && r.shares != null && r.shares > 0 && Number.isFinite(r.annualDivEst)) {
      totalAnnualDiv += r.annualDivEst * r.shares;
    }
  }
  if (totalMv > 0 && totalAnnualDiv > 0) return (totalAnnualDiv / totalMv) * 100;
  return null;
}

function sumMarketValue(rows: EnrichedHoldingRow[]): number {
  let t = 0;
  for (const r of rows) {
    if (r.marketValue != null && Number.isFinite(r.marketValue)) t += r.marketValue;
  }
  return t;
}

export function computeDividendBookBanner(
  allEquityRows: EnrichedHoldingRow[],
  dividendRows: EnrichedHoldingRow[],
  snapshotAsOf: string | null,
): DividendBookBanner {
  const totalEquityMarketValue = sumMarketValue(allEquityRows);
  const dividendMarketValue = sumMarketValue(dividendRows);
  const dividendShareOfBookPct =
    totalEquityMarketValue > 0 ? (dividendMarketValue / totalEquityMarketValue) * 100 : null;
  return {
    totalEquityMarketValue,
    dividendMarketValue,
    dividendShareOfBookPct,
    combinedBookYieldPct: weightedYieldPct(allEquityRows),
    dividendSliceYieldPct: weightedYieldPct(dividendRows),
    dividendSymbolCount: dividendRows.length,
    totalEquitySymbolCount: allEquityRows.length,
    snapshotAsOf,
  };
}

function qualifiesForDividendBookRow(
  db: Database.Database,
  row: EnrichedHoldingRow,
  meta: { securityType: string; assetType: string | null },
): boolean {
  if (holdingRowIsDividendProducer(db, row)) return true;
  return isSchwabFundLike(meta.securityType, meta.assetType);
}

export async function buildSchwabDividendBook(
  db: Database.Database,
  opts?: BuildSchwabDividendBookOptions,
): Promise<SchwabDividendBook> {
  const raw = loadLatestSchwabPositionRows(db);
  const snapshotAsOf =
    raw.length > 0
      ? raw.reduce((max, r) => (r.snapshotAsOf > max ? r.snapshotAsOf : max), raw[0]!.snapshotAsOf)
      : null;

  if (raw.length === 0) {
    return {
      banner: {
        totalEquityMarketValue: 0,
        dividendMarketValue: 0,
        dividendShareOfBookPct: null,
        combinedBookYieldPct: null,
        dividendSliceYieldPct: null,
        dividendSymbolCount: 0,
        totalEquitySymbolCount: 0,
        snapshotAsOf: null,
      },
      dividendRows: [],
      allEquityRows: [],
    };
  }

  const aggregated = aggregateBySymbol(raw);
  const bases = aggregated.map((a, i) => ({
    holdingId: a.symbol,
    symbol: a.symbol,
    shares: a.shares,
    sortOrder: i,
    avgUnitCost: a.avgUnitCost,
    securityType: a.securityType,
    assetType: a.assetType,
    snapshotMarketValue: a.snapshotMarketValue,
  }));

  const enrichOpts = {
    forceRefetchFundamentals: opts?.forceRefetchFundamentals,
    fetchLiveData: opts?.fetchLiveData,
  };
  const allEquityRows = await enrichSymbolHoldings(db, bases, enrichOpts);

  const dividendRows: SchwabDividendBookRow[] = [];
  for (const row of allEquityRows) {
    const agg = aggregated.find((a) => a.symbol === row.symbol);
    if (!agg || !qualifiesForDividendBookRow(db, row, agg)) continue;
    dividendRows.push({
      ...row,
      accountsLabel: agg ? [...new Set(agg.accountLabels)].sort().join(", ") : "",
      accountIds: agg?.accountIds ?? [],
    });
  }

  const banner = computeDividendBookBanner(allEquityRows, dividendRows, snapshotAsOf);

  return { banner, dividendRows, allEquityRows };
}

export function buildSchwabDividendDashboard(
  db: Database.Database,
  dividendRows: SchwabDividendBookRow[],
): PortfolioDashboard {
  const symbols = dividendRows.map((r) => r.symbol);
  const cashflows = fetchDividendCashflowsForSymbols(db, symbols, null);
  return buildPortfolioDashboard(
    dividendRows.map((r) => ({
      symbol: r.symbol,
      shares: r.shares,
      last: r.last,
      marketValue: r.marketValue,
      sector: r.sector,
      industry: r.industry,
      avgUnitCost: r.avgUnitCost,
    })),
    cashflows,
    inferHoldingCategory,
  );
}

export function bookHoldingsFooter(dividendRows: SchwabDividendBookRow[]) {
  return computeFooterTotals(dividendRows);
}

/** Aggregated share counts for dividend book forward snap / timeline. */
export function dividendBookHoldingQuantities(rows: SchwabDividendBookRow[]): Array<{ symbol: string; shares: number }> {
  return rows
    .filter((r) => r.shares != null && Number.isFinite(r.shares) && r.shares > 0)
    .map((r) => ({ symbol: r.symbol.toUpperCase(), shares: r.shares! }));
}
