/** Alpha preset id (legacy `dm_port_default` for backward compatibility). */
export const DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID = "dm_port_default";

export type DividendModelPresetPortfolio = {
  id: string;
  name: string;
  multiplier: number;
};

/** Seeded dividend model portfolios: alpha (1×), bravo (5×), charlie (10×). */
export const DIVIDEND_MODEL_PRESET_PORTFOLIOS: DividendModelPresetPortfolio[] = [
  { id: DEFAULT_DIVIDEND_MODEL_PORTFOLIO_ID, name: "Dividend model (alpha)", multiplier: 1 },
  { id: "dm_port_bravo", name: "Dividend model (bravo)", multiplier: 5 },
  { id: "dm_port_charlie", name: "Dividend model (charlie)", multiplier: 10 },
];

/** Alpha backtest target NAV at window start; bravo/charlie use multiplier × this base. */
export const DIVIDEND_MODEL_BASE_TARGET_NAV_USD = 20_000;

export function presetMultiplierForPortfolio(portfolioId: string): number | null {
  const preset = DIVIDEND_MODEL_PRESET_PORTFOLIOS.find((p) => p.id === portfolioId);
  return preset?.multiplier ?? null;
}

/** Preset portfolios: $20k × multiplier; custom portfolios use current total market value. */
export function targetNavUsdForPortfolio(portfolioId: string, currentTotalMarketValue: number): number {
  const mult = presetMultiplierForPortfolio(portfolioId);
  if (mult != null) return DIVIDEND_MODEL_BASE_TARGET_NAV_USD * mult;
  return currentTotalMarketValue > 0 && Number.isFinite(currentTotalMarketValue) ? currentTotalMarketValue : DIVIDEND_MODEL_BASE_TARGET_NAV_USD;
}

/** Default seed list for first-run dividend model portfolio (18 income / dividend names). */
export const DEFAULT_DIVIDEND_MODEL_SYMBOLS: string[] = [
  "PDI",
  "MLPI",
  "QQQI",
  "AGNC",
  "SPYI",
  "STWD",
  "ICAP",
  "GPIQ",
  "PFFA",
  "GPIX",
  "MPLX",
  "SCAP",
  "ET",
  "BST",
  "EPD",
  "O",
  "SCHD",
  "IBM",
];
