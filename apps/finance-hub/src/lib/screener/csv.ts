import { formatCorrelation, formatMarketCap, formatRatio } from "@/lib/screener/display";
import { sourceLabel } from "@/lib/screener/sourcesMeta";
import type { Cited, CorrWindow, ScreenerRow } from "@/lib/screener/types";

function csvEscape(value: string | number): string {
  const text = String(value);
  if (/[",\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

function flags(cited: Cited): string {
  return [cited.singleSource ? "single-source" : "", cited.disagreement ? "disagreement" : ""].filter(Boolean).join(" ");
}

function triple(cited: Cited, value: string): string[] {
  return [value === "—" ? "" : value, sourceLabel(cited.source), cited.asOf ?? "", flags(cited)];
}

export function screenerCsv(rows: ScreenerRow[], window: CorrWindow): string {
  const headers = [
    "ticker",
    "name",
    "in_sp500",
    "size_rank",
    "sector",
    "sector_source",
    "sector_as_of",
    "sector_flags",
    "industry",
    "industry_source",
    "industry_as_of",
    "industry_flags",
    "market_cap",
    "market_cap_source",
    "market_cap_as_of",
    "market_cap_flags",
    "pe_trailing",
    "pe_trailing_source",
    "pe_trailing_as_of",
    "pe_trailing_flags",
    "pe_forward",
    "pe_forward_source",
    "pe_forward_as_of",
    "pe_forward_flags",
    "peg",
    "peg_source",
    "peg_as_of",
    "peg_flags",
    "peg_growth_rate",
    "ps_trailing",
    "ps_trailing_source",
    "ps_trailing_as_of",
    "ps_trailing_flags",
    "ps_forward",
    "ps_forward_source",
    "ps_forward_as_of",
    "ps_forward_flags",
    "revenue_ttm",
    "revenue_ttm_source",
    "revenue_ttm_as_of",
    "revenue_ttm_flags",
    "eps_ttm",
    "eps_ttm_source",
    "eps_ttm_as_of",
    "eps_ttm_flags",
    "corr_spy",
    "corr_spy_source",
    "corr_spy_as_of",
    "corr_spy_flags",
    "corr_qqq",
    "corr_qqq_source",
    "corr_qqq_as_of",
    "corr_qqq_flags",
    "corr_window",
    "war_exposure",
    "war_source",
    "war_as_of",
    "war_source_url",
    "war_unverified",
  ];
  const lines = [headers.join(",")];
  for (const row of rows) {
    const printed =
      row.marketCap.source === "report:2026-11-12-close" && typeof row.marketCap.meta?.marketCapText === "string"
        ? row.marketCap.meta.marketCapText
        : null;
    const values = [
      row.ticker,
      row.name ?? "",
      row.inSp500 ? "yes" : "no",
      row.sizeRank ?? "",
      ...triple(row.sector, row.sector.valueText ?? ""),
      ...triple(row.industry, row.industry.valueText ?? ""),
      ...triple(row.marketCap, formatMarketCap(row.marketCap.valueNum, printed)),
      ...triple(row.peTrailing, formatRatio(row.peTrailing.valueNum)),
      ...triple(row.peForward, formatRatio(row.peForward.valueNum)),
      ...triple(row.peg, formatRatio(row.peg.valueNum)),
      typeof row.peg.meta?.growthRateLabel === "string" ? row.peg.meta.growthRateLabel : "",
      ...triple(row.psTrailing, formatRatio(row.psTrailing.valueNum)),
      ...triple(row.psForward, formatRatio(row.psForward.valueNum)),
      ...triple(row.revenueTtm, formatMarketCap(row.revenueTtm.valueNum)),
      ...triple(row.epsTtm, formatRatio(row.epsTtm.valueNum)),
      ...triple(row.corrSpy[window], formatCorrelation(row.corrSpy[window].valueNum)),
      ...triple(row.corrQqq[window], formatCorrelation(row.corrQqq[window].valueNum)),
      window,
      row.war.valueText ?? "",
      sourceLabel(row.war.source),
      row.war.asOf ?? "",
      row.war.sourceUrl ?? "",
      row.warUnverified ? "yes" : "no",
    ];
    lines.push(values.map(csvEscape).join(","));
  }
  return `${lines.join("\n")}\n`;
}
