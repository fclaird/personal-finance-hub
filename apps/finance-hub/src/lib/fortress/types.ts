/**
 * Fortress simulator, phases 1 and 2.
 * Phase 3 (tails, historical replay, proxy IV) and phase 4 (factors, geography,
 * fund look-through) are not implemented. Callers must not invent those outputs.
 */

export const FORTRESS_MODEL_VERSION = "fortress-ledger-1";
export const FORTRESS_RULE_VERSION = "manual-margin-1";

export const FORTRESS_PHASE = {
  implemented: [1, 2] as const,
  unavailable: [3, 4] as const,
};

export type IsoDate = string;

export type ExerciseStyle = "american" | "european";
export type OptionRight = "C" | "P";
export type SettlementKind = "physical" | "cash";

export type OptionContract = {
  readonly underlying: string;
  readonly right: OptionRight;
  readonly strike: number;
  readonly expiry: IsoDate;
  /** American is the default for listed single-name equity options. European is explicit. */
  readonly style: ExerciseStyle;
  readonly multiplier: number;
  readonly deliverableShares: number;
  readonly settlement: SettlementKind;
  /** Adjusted contracts block a complete verdict unless metadata is marked complete. */
  readonly adjusted: boolean;
  readonly adjustedMetadata: "missing" | "complete";
  readonly exotic: boolean;
};

export type EquityPosition = {
  readonly id: string;
  readonly kind: "equity" | "etf";
  readonly symbol: string;
  readonly accountId: string;
  readonly quantity: number;
  readonly mark: number;
  readonly averageCost: number;
};

export type OptionPosition = {
  readonly id: string;
  readonly kind: "option";
  readonly accountId: string;
  readonly quantity: number;
  readonly averageCost: number;
  /** Premium per underlying share. Null means the mark is unknown. */
  readonly mark: number | null;
  readonly delta: number | null;
  readonly gamma: number | null;
  /** ∂price/∂σ for a 1.00 change in vol, per share. Not per vol point. */
  readonly vegaPerVol: number | null;
  readonly contract: OptionContract;
};

export type Position = EquityPosition | OptionPosition;

export type CashLine = {
  readonly id: string;
  readonly accountId: string;
  readonly amount: number;
};

export type DatedFlow = {
  readonly id: string;
  readonly accountId: string;
  readonly amount: number;
  readonly due: IsoDate;
  readonly label: string;
};

export type DebtLine = {
  readonly id: string;
  readonly accountId: string;
  readonly principal: number;
  readonly annualRate: number;
};

export type Dividend = {
  readonly id: string;
  readonly underlying: string;
  readonly exDate: IsoDate;
  readonly amountPerShare: number;
};

export type MarginRules = {
  /** Long-stock maintenance fraction of market value. The stock fixture uses 0.30. */
  readonly maintenanceLong: number;
  /** Long-stock initial fraction. Not used as maintenance. */
  readonly initialLong: number;
  readonly provenance: "manual-assumption";
};

/**
 * What was actually recorded. A missing piece blocks a pass.
 * Share-count import is not a complete book.
 */
export type Completeness = {
  readonly cash: "recorded" | "missing";
  readonly debt: "recorded" | "missing";
  readonly contracts: "recorded" | "share-count-only";
  readonly quotes: "recorded" | "stale" | "missing";
  /** explicit-zero: no cash dividend and pricing yield is 0. discrete: cash dividends only, pricing yield stays 0. */
  readonly dividends: "explicit-zero" | "discrete" | "missing";
};

export const RECORDED_BOOK: Completeness = {
  cash: "recorded",
  debt: "recorded",
  contracts: "recorded",
  quotes: "recorded",
  dividends: "explicit-zero",
};

export type Snapshot = {
  readonly id: string;
  readonly version: 1;
  readonly currency: "USD";
  readonly asOf: IsoDate;
  readonly seed: number;
  readonly scope: { readonly regime: "synthetic" | "imported"; readonly label: string };
  readonly completeness: Completeness;
  readonly vintages: { readonly quotes: string; readonly model: string; readonly rules: string };
  readonly positions: readonly Position[];
  readonly cash: readonly CashLine[];
  readonly receivables: readonly DatedFlow[];
  readonly payables: readonly DatedFlow[];
  readonly debt: readonly DebtLine[];
  readonly dividends: readonly Dividend[];
  readonly margin: MarginRules;
  readonly appliedOpIds: readonly string[];
  readonly appliedEventIds: readonly string[];
  readonly realized: readonly { readonly id: string; readonly amount: number; readonly label: string }[];
  readonly residuals: readonly { readonly id: string; readonly amount: number; readonly label: string }[];
  /** External capital, signed. Deposits positive. Not profit. */
  readonly externalCapital: number;
};

export type Fill = {
  readonly price: number;
  readonly tradeDate: IsoDate;
  readonly fee: number;
};

export type Change =
  | {
      readonly op: "addEquity";
      readonly id: string;
      readonly accountId: string;
      readonly symbol: string;
      readonly instrument: "equity" | "etf";
      readonly quantity: number;
      readonly fill: Fill;
    }
  | {
      readonly op: "trimEquity";
      readonly id: string;
      readonly accountId: string;
      readonly symbol: string;
      readonly quantity: number;
      readonly fill: Fill;
    }
  | {
      readonly op: "replace";
      readonly id: string;
      readonly accountId: string;
      readonly sellSymbol: string;
      readonly sellQuantity: number | { readonly proportional: number };
      readonly buySymbol: string;
      readonly buyInstrument: "equity" | "etf";
      readonly sellFill: Fill;
      readonly buyFill: Fill;
    }
  | {
      readonly op: "openOption";
      readonly id: string;
      readonly accountId: string;
      readonly quantity: number;
      readonly contract: OptionContract;
      readonly fill: Fill;
    }
  | {
      readonly op: "closeOption";
      readonly id: string;
      readonly positionId: string;
      readonly quantity: number;
      readonly fill: Fill;
    }
  | {
      readonly op: "roll";
      readonly id: string;
      readonly timing: "simultaneous" | "sequential";
      readonly close: { readonly positionId: string; readonly quantity: number; readonly fill: Fill };
      readonly open: { readonly accountId: string; readonly quantity: number; readonly contract: OptionContract; readonly fill: Fill };
    }
  | {
      readonly op: "deposit" | "withdraw";
      readonly id: string;
      readonly accountId: string;
      readonly amount: number;
      readonly tradeDate: IsoDate;
    }
  | {
      readonly op: "borrow" | "repay";
      readonly id: string;
      readonly accountId: string;
      readonly amount: number;
      readonly annualRate: number;
      readonly tradeDate: IsoDate;
    }
  | {
      readonly op: "transfer";
      readonly id: string;
      readonly fromAccountId: string;
      readonly toAccountId: string;
      readonly amount: number;
      readonly tradeDate: IsoDate;
    }
  | {
      readonly op: "setMargin";
      readonly id: string;
      readonly maintenanceLong: number;
      readonly initialLong: number;
    };

export type Assumptions = {
  /** Equity and option premium settle this many calendar days after the trade. Default 1. */
  readonly settlementDays: number;
  /** Labeled default. Sequential rolls use each fill's own date. */
  readonly packageTiming: "simultaneous";
  readonly payInterestFromCash: boolean;
  readonly americanSteps: number;
  readonly rate: number;
  readonly dividendYield: number;
  readonly baseVol: number;
  readonly assignmentBeforeExpiry: "none" | "partial" | "full";
  readonly assignmentAtExpiry: "full";
  readonly operationalReserve: number;
};

export const DEFAULT_ASSUMPTIONS: Assumptions = {
  settlementDays: 1,
  packageTiming: "simultaneous",
  payInterestFromCash: false,
  americanSteps: 80,
  rate: 0.04,
  dividendYield: 0,
  baseVol: 0.25,
  assignmentBeforeExpiry: "none",
  assignmentAtExpiry: "full",
  operationalReserve: 0,
};

export const DEFAULT_MARGIN: MarginRules = {
  maintenanceLong: 0.3,
  initialLong: 0.5,
  provenance: "manual-assumption",
};

export type MarketState = {
  readonly asOf: IsoDate;
  readonly spots: Readonly<Record<string, number>>;
  readonly vols: Readonly<Record<string, number>>;
  readonly rate: number;
  readonly dividendYield: Readonly<Record<string, number>>;
};

export type MarketNode = {
  readonly id: string;
  readonly date: IsoDate;
  /** Multiplies every name's baseline spot. The same factors are used for both books. */
  readonly spotFactor: number;
  /** Added to each name's vol. Decimal, not vol points in the label sense of 1 = 100 vol points. */
  readonly volAdd: number;
  readonly rateAdd: number;
  /** Added to maintenance for this node only. A house requirement hike, not new capital. */
  readonly houseHike: number;
};

export type LimitDirection = "max" | "min";

export type Threshold = {
  readonly id: string;
  readonly metric: string;
  /** Null means the user has not set a limit. The row is not evaluated. */
  readonly limit: number | null;
  /** "max": breach when value > limit. "min": breach when value < limit. */
  readonly direction: LimitDirection;
  readonly required: boolean;
};
