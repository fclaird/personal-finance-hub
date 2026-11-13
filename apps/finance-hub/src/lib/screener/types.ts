export const SCREENER_FIELDS = [
  "gics_sector",
  "industry",
  "blurb",
  "market_cap",
  "pe_trailing",
  "pe_forward",
  "peg",
  "ps_trailing",
  "ps_forward",
  "pe_schwab",
  "revenue_ttm",
  "eps_ttm",
  "corr_spy",
  "corr_qqq",
  "war_exposure",
  "sector_vendor",
  "industry_vendor",
] as const;

export type ScreenerField = (typeof SCREENER_FIELDS)[number];

export const CORR_WINDOWS = ["3m", "1y", "3y"] as const;
export type CorrWindow = (typeof CORR_WINDOWS)[number];

export const WAR_RATINGS = ["High", "Medium", "Low", "Beneficiary", "n/a"] as const;
export type WarRating = (typeof WAR_RATINGS)[number];

export const MARKET_CAP_BANDS = ["mega", "large", "mid", "small", "micro"] as const;
export type MarketCapBand = (typeof MARKET_CAP_BANDS)[number];

export type CorrBand = "H" | "M" | "L";

/** One cited reading. A blank cell is an observation that was never stored. */
export type ObservationInput = {
  field: ScreenerField;
  source: string;
  valueNum?: number | null;
  valueText?: string | null;
  asOf?: string | null;
  sourceUrl?: string | null;
  meta?: Record<string, unknown> | null;
};

export type StoredObservation = ObservationInput & {
  ticker: string;
  fetchedAt: string;
};

export type CitedPeer = {
  source: string;
  valueNum: number | null;
  valueText: string | null;
  asOf: string | null;
  sourceUrl: string | null;
  relativeGap: number | null;
  /** Same field, different classification system. Not a disagreement. */
  otherClassification: boolean;
};

export type Cited = {
  valueNum: number | null;
  valueText: string | null;
  source: string | null;
  asOf: string | null;
  fetchedAt: string | null;
  sourceUrl: string | null;
  meta: Record<string, unknown> | null;
  singleSource: boolean;
  disagreement: boolean;
  peers: CitedPeer[];
};

export type ScreenerFilters = {
  sectors: string[];
  marketCapBands: MarketCapBand[];
  sizeRankMax: number | null;
  corrWindow: CorrWindow;
  corrTarget: "spy" | "qqq" | "both";
  corrBand: CorrBand | null;
  corrMin: number | null;
  corrMax: number | null;
  peTrailingMin: number | null;
  peTrailingMax: number | null;
  peForwardMin: number | null;
  peForwardMax: number | null;
  pegMin: number | null;
  pegMax: number | null;
  /** When false, pegMax is exclusive (the built-in PEG<1.5 screen). */
  pegMaxInclusive: boolean;
  psTrailingMin: number | null;
  psTrailingMax: number | null;
  psForwardMin: number | null;
  psForwardMax: number | null;
  warExposure: WarRating[];
  /** Hide constituents that have no cited figure yet. */
  requireCited: boolean;
};

export type ScreenerRow = {
  ticker: string;
  name: string | null;
  inSp500: boolean;
  origin: string;
  cik: number | null;
  sector: Cited;
  industry: Cited;
  blurb: Cited;
  marketCap: Cited;
  peTrailing: Cited;
  peForward: Cited;
  peg: Cited;
  psTrailing: Cited;
  psForward: Cited;
  peSchwab: Cited;
  revenueTtm: Cited;
  epsTtm: Cited;
  corrSpy: Record<CorrWindow, Cited>;
  corrQqq: Record<CorrWindow, Cited>;
  war: Cited;
  warUnverified: boolean;
  warNote: string | null;
  sizeRank: number | null;
};

export type ScreenerPreset = {
  id: string;
  name: string;
  filters: ScreenerFilters;
  builtIn: boolean;
};

export type SourceAvailability = {
  id: string;
  label: string;
  env: string | null;
  state: "ready" | "skipped";
  detail: string;
};

export type ScreenerPageData = {
  name: string;
  rows: ScreenerRow[];
  presets: ScreenerPreset[];
  sources: SourceAvailability[];
  universe: {
    sp500Count: number;
    sp500Url: string;
    sp500RevisionUrl: string;
    sp500RevisionTimestamp: string;
    sp500RetrievedOn: string;
    figuresAsOf: string;
    figuresAsOfDetail: string;
    reportOnlyTickers: string[];
  };
  generatedAt: string;
};

export const EMPTY_CITED: Cited = {
  valueNum: null,
  valueText: null,
  source: null,
  asOf: null,
  fetchedAt: null,
  sourceUrl: null,
  meta: null,
  singleSource: false,
  disagreement: false,
  peers: [],
};
