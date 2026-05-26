export type RegionalMarketId = "us" | "jp" | "kr" | "uk";

export type RegionalMarketInstrument = {
  id: string;
  region: RegionalMarketId;
  label: string;
  yahooSymbol: string;
  /** Stooq CSV symbol; omit when unavailable on Stooq. */
  stooqSymbol?: string;
  /** Yahoo chart includes pre/post for US index futures overnight moves. */
  includePrePost?: boolean;
};

export const REGIONAL_MARKET_INSTRUMENTS: RegionalMarketInstrument[] = [
  {
    id: "jp-n225",
    region: "jp",
    label: "Nikkei 225",
    yahooSymbol: "^N225",
  },
  {
    id: "us-es",
    region: "us",
    label: "S&P 500 E-mini",
    yahooSymbol: "ES=F",
    stooqSymbol: "es.f",
    includePrePost: true,
  },
  {
    id: "us-nq",
    region: "us",
    label: "Nasdaq 100 E-mini",
    yahooSymbol: "NQ=F",
    stooqSymbol: "nq.f",
    includePrePost: true,
  },
];

/** WTI Crude — selectable on the Markets quick-glance 4th tile. */
export const WTI_CRUDE_INSTRUMENT: RegionalMarketInstrument = {
  id: "us-cl",
  region: "us",
  label: "WTI Crude",
  yahooSymbol: "CL=F",
  stooqSymbol: "cl.f",
  includePrePost: true,
};

export const REGIONAL_MARKET_LABELS: Record<RegionalMarketId, string> = {
  us: "United States",
  jp: "Japan",
  kr: "Korea",
  uk: "United Kingdom",
};
