const LABELS: Record<string, string> = {
  schwab: "Schwab marketdata instruments, projection=fundamental",
  yahoo: "Yahoo Finance quoteSummary (unofficial)",
  yahoo_computed: "Computed from Yahoo Finance fields in the same response",
  yahoo_consensus: "Yahoo Finance consensus estimate (earningsTrend)",
  yahoo_adjclose: "Pearson correlation of Yahoo Finance adjusted-close daily returns",
  finnhub: "Finnhub /stock/metric",
  fmp: "Financial Modeling Prep ratios-ttm",
  alphavantage: "Alpha Vantage OVERVIEW",
  sec: "SEC EDGAR companyfacts",
  sec_computed: "Computed from SEC companyfacts and a cited price",
  "report:2026-11-12-close": "Market-cap reports, figures as of the Nov 12, 2026 close",
  "wikipedia:list_of_sp500_companies": "Wikipedia List of S&P 500 companies",
  manual: "Edited in Screener",
};

export function sourceLabel(source: string | null): string {
  if (!source) return "";
  return LABELS[source] ?? source;
}

export const FIELD_PRIORITY: Record<string, readonly string[]> = {
  gics_sector: ["report:2026-11-12-close", "wikipedia:list_of_sp500_companies"],
  industry: ["wikipedia:list_of_sp500_companies", "yahoo", "finnhub", "fmp", "alphavantage", "schwab"],
  blurb: ["report:2026-11-12-close", "yahoo", "alphavantage"],
  market_cap: ["schwab", "yahoo", "fmp", "alphavantage", "finnhub", "report:2026-11-12-close"],
  pe_trailing: ["yahoo_computed", "finnhub", "fmp", "alphavantage", "sec_computed"],
  pe_forward: ["yahoo", "alphavantage", "fmp"],
  peg: ["schwab", "yahoo", "finnhub", "fmp", "alphavantage"],
  ps_trailing: ["schwab", "finnhub", "fmp", "alphavantage", "sec_computed"],
  ps_forward: ["yahoo_consensus"],
  pe_schwab: ["schwab"],
  revenue_ttm: ["sec", "alphavantage"],
  eps_ttm: ["sec", "alphavantage"],
  corr_spy: ["yahoo_adjclose", "report:2026-11-12-close"],
  corr_qqq: ["yahoo_adjclose", "report:2026-11-12-close"],
  war_exposure: ["manual", "report:2026-11-12-close"],
  sector_vendor: ["yahoo", "finnhub", "fmp", "alphavantage", "schwab"],
  industry_vendor: ["yahoo", "finnhub", "fmp", "alphavantage", "schwab"],
};

export const REPORT_SOURCE = "report:2026-11-12-close";
export const WIKI_SOURCE = "wikipedia:list_of_sp500_companies";
export const REPORT_AS_OF = "2026-11-12";
export const REPORT_PREPARED_AT = "2026-11-13T13:00:00.000Z";
