import type { SchwabCompanyPayload } from "@/lib/schwab/instrumentFundamental";

import { EPS_CONCEPTS, REVENUE_CONCEPTS, trailingFromCompanyFacts } from "@/lib/screener/secTtm";
import type { ObservationInput } from "@/lib/screener/types";

function num(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "" && Number.isFinite(Number(value))) return Number(value);
  return null;
}

function rawOf(value: unknown): number | null {
  if (value && typeof value === "object" && "raw" in value) return num((value as { raw?: unknown }).raw);
  return num(value);
}

function textOf(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
}

export function nyDateFromUnix(seconds: number): string | null {
  if (!Number.isFinite(seconds)) return null;
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(seconds * 1000));
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;
  if (!year || !month || !day) return null;
  return `${year}-${month}-${day}`;
}

function push(out: ObservationInput[], input: ObservationInput | null) {
  if (!input) return;
  const hasNum = typeof input.valueNum === "number" && Number.isFinite(input.valueNum);
  const hasText = typeof input.valueText === "string" && input.valueText.trim() !== "";
  if (!hasNum && !hasText) return;
  out.push(input);
}

/**
 * Schwab instruments `projection=fundamental`.
 * Field names follow the published instruments schema (peRatio, pegRatio, prRatio, epsTTM, marketCap).
 * peRatio is not labeled trailing or forward, so it is stored on pe_schwab and not copied into either P/E column.
 * No forward-named ratio exists on that schema.
 */
export function parseSchwabFundamentals(payload: SchwabCompanyPayload, fetchedAt: string): ObservationInput[] {
  const raw = payload.raw ?? {};
  const asOf = fetchedAt.slice(0, 10);
  const out: ObservationInput[] = [];
  const marketCap = num(raw.marketCap) ?? payload.marketCap;
  if (marketCap != null && marketCap > 0) {
    push(out, {
      field: "market_cap",
      source: "schwab",
      valueNum: marketCap,
      asOf,
      meta: { asOfBasis: "Fetch date. The fundamental payload has no as-of field.", field: "marketCap" },
    });
  }
  const pe = num(raw.peRatio);
  if (pe != null) {
    push(out, {
      field: "pe_schwab",
      source: "schwab",
      valueNum: pe,
      asOf,
      meta: {
        field: "peRatio",
        basis: "Schwab names this price-to-earnings. It is not labeled trailing or forward, so it is not shown in those columns.",
      },
    });
  }
  const peg = num(raw.pegRatio);
  if (peg != null) {
    push(out, {
      field: "peg",
      source: "schwab",
      valueNum: peg,
      asOf,
      meta: { field: "pegRatio", growthRate: null, growthRateLabel: "not stated by Schwab pegRatio" },
    });
  }
  const pr = num(raw.prRatio);
  if (pr != null) {
    push(out, {
      field: "ps_trailing",
      source: "schwab",
      valueNum: pr,
      asOf,
      meta: {
        field: "prRatio",
        basis: "Schwab documents prRatio as the price-to-revenue ratio. The field name does not say TTM or forward.",
      },
    });
  }
  if (payload.sector) {
    push(out, {
      field: "sector_vendor",
      source: "schwab",
      valueText: payload.sector,
      asOf,
      meta: { classification: "Schwab sector" },
    });
  }
  if (payload.industry) {
    push(out, {
      field: "industry_vendor",
      source: "schwab",
      valueText: payload.industry,
      asOf,
      meta: { classification: "Schwab industry" },
    });
  }
  return out;
}

type YahooSummary = {
  price?: Record<string, unknown>;
  defaultKeyStatistics?: Record<string, unknown>;
  assetProfile?: Record<string, unknown>;
  financialData?: Record<string, unknown>;
  earningsTrend?: { trend?: Array<Record<string, unknown>> };
};

/** quoteSummary modules checked live for AAPL on 2026-11-13. trailingPE was absent. pegRatio did not name a growth horizon. */
export function parseYahooQuoteSummary(payload: unknown, fetchedAt: string): ObservationInput[] {
  const root = payload as { quoteSummary?: { result?: YahooSummary[] } };
  const row = root.quoteSummary?.result?.[0];
  if (!row) return [];
  const stats = row.defaultKeyStatistics ?? {};
  const price = row.price ?? {};
  const profile = row.assetProfile ?? {};
  const marketTime = rawOf(price.regularMarketTime);
  const asOf = (marketTime != null ? nyDateFromUnix(marketTime) : null) ?? fetchedAt.slice(0, 10);
  const out: ObservationInput[] = [];
  const marketCap = rawOf(price.marketCap);
  if (marketCap != null && marketCap > 0) {
    push(out, { field: "market_cap", source: "yahoo", valueNum: marketCap, asOf, meta: { field: "price.marketCap" } });
  }
  const forwardPe = rawOf(stats.forwardPE);
  if (forwardPe != null) {
    push(out, {
      field: "pe_forward",
      source: "yahoo",
      valueNum: forwardPe,
      asOf,
      meta: { field: "defaultKeyStatistics.forwardPE", estimate: true, label: "consensus estimate" },
    });
  }
  const peg = rawOf(stats.pegRatio);
  if (peg != null) {
    push(out, {
      field: "peg",
      source: "yahoo",
      valueNum: peg,
      asOf,
      meta: { field: "defaultKeyStatistics.pegRatio", growthRate: null, growthRateLabel: "not stated in the quoteSummary payload" },
    });
  }
  const last = rawOf(price.regularMarketPrice);
  const trailingEps = rawOf(stats.trailingEps);
  if (last != null && last > 0 && trailingEps != null && trailingEps > 0) {
    push(out, {
      field: "pe_trailing",
      source: "yahoo_computed",
      valueNum: last / trailingEps,
      asOf,
      meta: {
        formula: "regularMarketPrice / trailingEps",
        price: last,
        trailingEps,
        estimate: false,
        note: "Yahoo quoteSummary did not include a trailingPE field on the live AAPL response. This is the ratio of the two cited fields.",
      },
    });
  }
  const sector = textOf(profile.sector);
  if (sector) {
    push(out, {
      field: "sector_vendor",
      source: "yahoo",
      valueText: sector,
      asOf: fetchedAt.slice(0, 10),
      meta: { classification: "Yahoo sector", note: "Not labeled GICS. Yahoo uses a shorter sector name than GICS." },
    });
  }
  const industry = textOf(profile.industry);
  if (industry) {
    push(out, {
      field: "industry_vendor",
      source: "yahoo",
      valueText: industry,
      asOf: fetchedAt.slice(0, 10),
      meta: { classification: "Yahoo industry" },
    });
  }
  const blurb = textOf(profile.longBusinessSummary);
  if (blurb) {
    push(out, { field: "blurb", source: "yahoo", valueText: blurb, asOf: fetchedAt.slice(0, 10), meta: { field: "longBusinessSummary" } });
  }
  const trend = row.earningsTrend?.trend ?? [];
  const currentYear = trend.find((item) => item.period === "0y");
  const revenueAvg = rawOf((currentYear?.revenueEstimate as { avg?: unknown } | undefined)?.avg);
  const analysts = rawOf((currentYear?.revenueEstimate as { numberOfAnalysts?: unknown } | undefined)?.numberOfAnalysts);
  if (marketCap != null && marketCap > 0 && revenueAvg != null && revenueAvg > 0) {
    push(out, {
      field: "ps_forward",
      source: "yahoo_consensus",
      valueNum: marketCap / revenueAvg,
      asOf,
      meta: {
        estimate: true,
        label: "consensus estimate",
        formula: "marketCap / earningsTrend period 0y revenueEstimate.avg",
        period: "0y",
        revenue: revenueAvg,
        analysts,
        note: "Current-fiscal-year consensus revenue, not a published forward P/S field. No verified source publishes forward P/S directly.",
      },
    });
  }
  return out;
}

export function parseFinnhubMetric(payload: unknown, fetchedAt: string): ObservationInput[] {
  const metric = (payload as { metric?: Record<string, unknown> } | null)?.metric;
  if (!metric) return [];
  const asOf = fetchedAt.slice(0, 10);
  const out: ObservationInput[] = [];
  const pe = num(metric.peTTM) ?? num(metric.peBasicExclExtraTTM);
  if (pe != null) {
    push(out, {
      field: "pe_trailing",
      source: "finnhub",
      valueNum: pe,
      asOf,
      meta: { field: num(metric.peTTM) != null ? "peTTM" : "peBasicExclExtraTTM" },
    });
  }
  const ps = num(metric.psTTM);
  if (ps != null) push(out, { field: "ps_trailing", source: "finnhub", valueNum: ps, asOf, meta: { field: "psTTM" } });
  const peg = num(metric.pegTTM);
  if (peg != null) {
    push(out, {
      field: "peg",
      source: "finnhub",
      valueNum: peg,
      asOf,
      meta: { field: "pegTTM", growthRate: null, growthRateLabel: "not stated by Finnhub pegTTM" },
    });
  }
  return out;
}

export function parseFmpRatios(payload: unknown, fetchedAt: string): ObservationInput[] {
  const row = Array.isArray(payload) ? (payload[0] as Record<string, unknown> | undefined) : (payload as Record<string, unknown> | null);
  if (!row || typeof row !== "object") return [];
  const asOf = fetchedAt.slice(0, 10);
  const out: ObservationInput[] = [];
  const pe = num(row.priceToEarningsRatioTTM);
  if (pe != null) push(out, { field: "pe_trailing", source: "fmp", valueNum: pe, asOf, meta: { field: "priceToEarningsRatioTTM" } });
  const ps = num(row.priceToSalesRatioTTM);
  if (ps != null) push(out, { field: "ps_trailing", source: "fmp", valueNum: ps, asOf, meta: { field: "priceToSalesRatioTTM" } });
  const peg = num(row.priceToEarningsGrowthRatioTTM);
  if (peg != null) {
    push(out, {
      field: "peg",
      source: "fmp",
      valueNum: peg,
      asOf,
      meta: {
        field: "priceToEarningsGrowthRatioTTM",
        growthRate: null,
        growthRateLabel: "FMP field priceToEarningsGrowthRatioTTM; the growth rate itself is not a separate value",
      },
    });
  }
  return out;
}

/** OVERVIEW fields checked with the public demo key for IBM on 2026-11-13. PERatio equalled TrailingPE and is not stored as a second source. */
export function parseAlphaOverview(payload: unknown, fetchedAt: string): ObservationInput[] {
  const row = payload as Record<string, unknown> | null;
  if (!row || typeof row !== "object") return [];
  if (row.Note || row.Information || row["Error Message"]) return [];
  const asOf = fetchedAt.slice(0, 10);
  const latestQuarter = textOf(row.LatestQuarter);
  const out: ObservationInput[] = [];
  const marketCap = num(row.MarketCapitalization);
  if (marketCap != null && marketCap > 0) {
    push(out, { field: "market_cap", source: "alphavantage", valueNum: marketCap, asOf, meta: { field: "MarketCapitalization", latestQuarter } });
  }
  const trailing = num(row.TrailingPE);
  if (trailing != null) push(out, { field: "pe_trailing", source: "alphavantage", valueNum: trailing, asOf, meta: { field: "TrailingPE", latestQuarter } });
  const forward = num(row.ForwardPE);
  if (forward != null) {
    push(out, {
      field: "pe_forward",
      source: "alphavantage",
      valueNum: forward,
      asOf,
      meta: { field: "ForwardPE", estimate: true, label: "consensus estimate", latestQuarter },
    });
  }
  const peg = num(row.PEGRatio);
  if (peg != null) {
    push(out, {
      field: "peg",
      source: "alphavantage",
      valueNum: peg,
      asOf,
      meta: {
        field: "PEGRatio",
        growthRate: null,
        growthRateLabel: "OVERVIEW does not name the growth rate. QuarterlyEarningsGrowthYOY is a different field and is not used.",
        latestQuarter,
      },
    });
  }
  const ps = num(row.PriceToSalesRatioTTM);
  if (ps != null) {
    push(out, { field: "ps_trailing", source: "alphavantage", valueNum: ps, asOf, meta: { field: "PriceToSalesRatioTTM", latestQuarter } });
  }
  const revenue = num(row.RevenueTTM);
  if (revenue != null) {
    push(out, {
      field: "revenue_ttm",
      source: "alphavantage",
      valueNum: revenue,
      asOf: latestQuarter ?? asOf,
      meta: { field: "RevenueTTM", latestQuarter },
    });
  }
  const eps = num(row.DilutedEPSTTM);
  if (eps != null) {
    push(out, { field: "eps_ttm", source: "alphavantage", valueNum: eps, asOf: latestQuarter ?? asOf, meta: { field: "DilutedEPSTTM", latestQuarter } });
  }
  const description = textOf(row.Description);
  if (description) push(out, { field: "blurb", source: "alphavantage", valueText: description, asOf, meta: { field: "Description" } });
  const sector = textOf(row.Sector);
  if (sector) {
    push(out, { field: "sector_vendor", source: "alphavantage", valueText: sector, asOf, meta: { classification: "Alpha Vantage sector" } });
  }
  const industry = textOf(row.Industry);
  if (industry) {
    push(out, { field: "industry_vendor", source: "alphavantage", valueText: industry, asOf, meta: { classification: "Alpha Vantage industry" } });
  }
  return out;
}

export function parseSecCompanyFacts(payload: unknown, fetchedAt: string): ObservationInput[] {
  const out: ObservationInput[] = [];
  const revenue = trailingFromCompanyFacts(payload, REVENUE_CONCEPTS);
  if (revenue) {
    push(out, {
      field: "revenue_ttm",
      source: "sec",
      valueNum: revenue.value,
      asOf: revenue.asOf,
      sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/",
      meta: { method: revenue.method, concept: revenue.concept, facts: revenue.facts, fetchedAt },
    });
  }
  const eps = trailingFromCompanyFacts(payload, EPS_CONCEPTS);
  if (eps) {
    push(out, {
      field: "eps_ttm",
      source: "sec",
      valueNum: eps.value,
      asOf: eps.asOf,
      sourceUrl: "https://data.sec.gov/api/xbrl/companyfacts/",
      meta: { method: eps.method, concept: eps.concept, facts: eps.facts, fetchedAt },
    });
  }
  return out;
}

export type YahooBar = { date: string; adjClose: number };

export function parseYahooChartBars(payload: unknown): YahooBar[] {
  const result = (payload as { chart?: { result?: Array<Record<string, unknown>> } }).chart?.result?.[0];
  if (!result) return [];
  const timestamps = result.timestamp;
  const adj = (result.indicators as { adjclose?: Array<{ adjclose?: Array<number | null> }> } | undefined)?.adjclose?.[0]?.adjclose;
  if (!Array.isArray(timestamps) || !adj) return [];
  const bars: YahooBar[] = [];
  for (let i = 0; i < timestamps.length; i++) {
    const ts = timestamps[i];
    const close = adj[i];
    if (typeof ts !== "number" || typeof close !== "number" || !Number.isFinite(close) || close <= 0) continue;
    const date = nyDateFromUnix(ts);
    if (!date) continue;
    bars.push({ date, adjClose: close });
  }
  return bars;
}
