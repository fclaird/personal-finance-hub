import { fetchYahooDailyChart } from "@/lib/market/yahooChartFetch";
import { fetchYahooLatestPrice, navFromYahooChartResult } from "@/lib/market/yahooLatestPrice";

/** One-time 529 / plan statement anchor; MV tracks the public fund return from that date. */
export type FundStatementBasis = {
  statementMarketValue: number;
  statementDate: string;
  basisTickerNav: number;
};

export function parseFundStatementBasis(meta: {
  fundBasis?: FundStatementBasis | null;
} | null): FundStatementBasis | null {
  const b = meta?.fundBasis;
  if (!b) return null;
  if (
    typeof b.statementMarketValue !== "number" ||
    !Number.isFinite(b.statementMarketValue) ||
    b.statementMarketValue <= 0
  ) {
    return null;
  }
  if (typeof b.statementDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(b.statementDate)) return null;
  if (typeof b.basisTickerNav !== "number" || !Number.isFinite(b.basisTickerNav) || b.basisTickerNav <= 0) {
    return null;
  }
  if (isSyntheticFallbackFundBasis(b)) return null;
  return b;
}

export function isSyntheticFallbackFundBasis(b: FundStatementBasis | null | undefined): b is FundStatementBasis {
  return (
    b != null &&
    typeof b.statementMarketValue === "number" &&
    Number.isFinite(b.statementMarketValue) &&
    b.statementMarketValue > 0 &&
    typeof b.statementDate === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(b.statementDate) &&
    b.basisTickerNav === 1
  );
}

export function createFundStatementBasis(
  statementMarketValue: number,
  statementDate: string,
  navOnDate: number | null,
): FundStatementBasis | null {
  if (!Number.isFinite(statementMarketValue) || statementMarketValue <= 0) return null;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(statementDate)) return null;
  if (navOnDate == null || !Number.isFinite(navOnDate) || navOnDate <= 0) return null;
  return {
    statementMarketValue,
    statementDate,
    basisTickerNav: navOnDate,
  };
}

/** Yahoo close on `isoDate` or the last trading day on/before it. */
export function yahooCloseOnOrBefore(result: Record<string, unknown>, isoDate: string): number | null {
  const timestamps = (result.timestamp as number[] | undefined) ?? [];
  const quote = (result.indicators as Record<string, unknown> | undefined)?.quote as
    | Array<Record<string, unknown>>
    | undefined;
  const closes = (quote?.[0]?.close as Array<number | null> | undefined) ?? [];
  const targetMs = new Date(`${isoDate}T23:59:59Z`).getTime();
  let best: { ts: number; close: number } | null = null;
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const c = closes[i];
    if (ts == null || c == null || !Number.isFinite(c) || c <= 0) continue;
    const ms = ts * 1000;
    if (ms > targetMs) continue;
    if (!best || ms > best.ts) best = { ts: ms, close: c };
  }
  return best?.close ?? null;
}

export async function fetchYahooNavOnDate(symbol: string, isoDate: string): Promise<number | null> {
  const chart = await fetchYahooDailyChart(symbol, "10y");
  if (!chart?.result) return null;
  return yahooCloseOnOrBefore(chart.result, isoDate);
}

export async function buildFundStatementBasis(
  symbol: string,
  statementMarketValue: number,
  statementDate: string,
): Promise<FundStatementBasis | null> {
  const navOnDate =
    (await fetchYahooNavOnDate(symbol, statementDate)) ?? (await fetchYahooLatestPrice(symbol));
  return createFundStatementBasis(statementMarketValue, statementDate, navOnDate);
}

/** Mark statement balance to today using public fund NAV return since the anchor date. */
export function markToMarketFund(
  basis: FundStatementBasis,
  navToday: number,
  navOnBasisDate?: number | null,
): number {
  const ref = navOnBasisDate ?? basis.basisTickerNav;
  if (!Number.isFinite(ref) || ref <= 0 || !Number.isFinite(navToday) || navToday <= 0) {
    return basis.statementMarketValue;
  }
  return basis.statementMarketValue * (navToday / ref);
}

export function needsPlanFundPricing(
  isManual: boolean,
  securityType: string,
  accountBucket: string | null,
): boolean {
  return isManual && (securityType === "fund" || accountBucket === "529");
}

/** Public NAV × qty is misleading for plan holdings when it diverges strongly from statement MV. */
/** Re-basis when anchor NAV is from an old date and mark-to-market drifts far above statement balance. */
export function repairFundBasisIfMarkDrift(
  basis: FundStatementBasis,
  navToday: number,
  quantity: number,
): FundStatementBasis | null {
  const marked = markToMarketFund(basis, navToday);
  if (marked <= basis.statementMarketValue * 1.12) return null;
  if (!publicNavTimesQtyMismatch(quantity, basis.statementMarketValue, navToday)) return null;
  const today = new Date().toISOString().slice(0, 10);
  return {
    statementMarketValue: basis.statementMarketValue,
    statementDate: today,
    basisTickerNav: navToday,
  };
}

export function publicNavTimesQtyMismatch(
  quantity: number,
  statementMarketValue: number,
  publicNav: number,
  ratioThreshold = 1.35,
): boolean {
  if (!Number.isFinite(quantity) || quantity <= 0) return false;
  if (!Number.isFinite(statementMarketValue) || statementMarketValue <= 0) return false;
  if (!Number.isFinite(publicNav) || publicNav <= 0) return false;
  const implied = quantity * publicNav;
  const ratio = implied / statementMarketValue;
  return ratio >= ratioThreshold || ratio <= 1 / ratioThreshold;
}
