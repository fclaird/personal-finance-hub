export type SchwabCategoryHint = {
  securityType?: string | null;
  assetType?: string | null;
};

/** Schwab mutual funds / ETFs (including legacy rows stored as security_type other). */
export function isSchwabFundLike(securityType: string | null | undefined, assetType: string | null | undefined): boolean {
  const st = (securityType ?? "").toLowerCase();
  const at = (assetType ?? "").toUpperCase();
  if (st === "fund") return true;
  if (
    at.includes("MUTUAL_FUND") ||
    at === "ETF" ||
    at.includes("EXCHANGE_TRADED") ||
    at.includes("COLLECTIVE_INVESTMENT") ||
    (at.includes("FUND") && !at.includes("PENSION"))
  ) {
    return true;
  }
  return false;
}

/** Display category for dividend-model inventory (heuristic + Schwab sector/industry). */
export function inferHoldingCategory(
  symbol: string,
  sector: string | null,
  industry: string | null,
  schwab?: SchwabCategoryHint | null,
): string {
  const sym = (symbol ?? "").trim().toUpperCase();
  const s = (sector ?? "").toLowerCase();
  const ind = (industry ?? "").toLowerCase();
  const at = (schwab?.assetType ?? "").toUpperCase();
  const st = (schwab?.securityType ?? "").toLowerCase();

  if (at.includes("MUTUAL_FUND")) return "Mutual Funds";
  if (at.includes("EXCHANGE_TRADED") || at === "ETF" || at.includes("COLLECTIVE_INVESTMENT")) return "ETFs";
  if (st === "fund" || (at.includes("FUND") && !at.includes("PENSION"))) return "Mutual Funds / ETFs";

  if (ind.includes("reit") || s.includes("real estate")) return "REITs";
  if (ind.includes("mlp") || ind.includes("midstream") || ind.includes("pipeline") || s.includes("energy"))
    return "MLPs / Energy Infra";
  if (ind.includes("cef") || ind.includes("closed-end")) return "CEFs";
  if (ind.includes("bdc") || ind.includes("business development")) return "BDCs";
  if (sym.includes("JEPI") || sym.includes("JEPQ") || sym.includes("DIVO") || sym.includes("QYLD")) return "Option-Income ETFs";
  if (sym.includes("SCHD") || sym.includes("VYM") || sym.includes("DGRO") || sym.includes("VIG")) return "Dividend Growth ETFs";
  if (sym.includes("BND") || sym.includes("AGG") || sym.includes("TLT") || s.includes("bond")) return "Bond ETFs";
  if (s.includes("technology") || ind.includes("software")) return "Technology";
  if (s.includes("financial")) return "Financial Services";
  if (s.includes("consumer") && s.includes("defensive")) return "Consumer Defensive";
  if (s.includes("consumer") && s.includes("cyclical")) return "Consumer Cyclical";
  if (s.includes("health")) return "Healthcare";
  if (s.includes("utilities")) return "Utilities";
  if (s.includes("industrial")) return "Industrials";
  if (s.includes("communication")) return "Communication";
  if (s.includes("etf")) return "ETFs";
  if (s) return s.replace(/\b\w/g, (c) => c.toUpperCase());
  return "Individual Stocks";
}
