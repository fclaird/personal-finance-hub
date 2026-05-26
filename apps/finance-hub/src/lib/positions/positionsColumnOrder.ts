/** Shared position-table column ids (drag order propagates across all position tables). */
export type PositionsColumnId =
  | "account"
  | "symbol"
  | "quantity"
  | "price"
  | "marketValue"
  | "purchaseDate"
  | "delta"
  | "gamma"
  | "theta"
  | "dte"
  | "intrinsic"
  | "extrinsic"
  | "syntheticShares";

export const POSITIONS_COLUMN_DEFAULT_ORDER: readonly PositionsColumnId[] = [
  "account",
  "symbol",
  "quantity",
  "price",
  "marketValue",
  "purchaseDate",
  "delta",
  "gamma",
  "theta",
  "dte",
  "intrinsic",
  "extrinsic",
  "syntheticShares",
];

export const POSITIONS_COLUMN_ORDER_STORAGE_KEY = "positions:column_order:v2";

export const POSITIONS_COLUMN_ORDER_LEGACY_KEYS = [
  "positions:grouped:v1:withAccount",
  "positions:grouped:v1:noAccount",
] as const;

export const POSITIONS_COLUMN_LABEL: Record<PositionsColumnId, string> = {
  account: "Account",
  symbol: "Symbol",
  quantity: "Qty",
  price: "Price",
  marketValue: "Market\u00A0value",
  purchaseDate: "Purchased",
  delta: "Delta",
  gamma: "Gamma",
  theta: "Theta",
  dte: "DTE",
  intrinsic: "Intrinsic",
  extrinsic: "Extrinsic",
  syntheticShares: "Synth\u00A0sh",
};

/** Sortable data columns (excludes account / syntheticShares). */
export type PositionsSortColumn = Exclude<PositionsColumnId, "account" | "syntheticShares">;

export const POSITIONS_SORT_COLUMNS: readonly PositionsSortColumn[] = POSITIONS_COLUMN_DEFAULT_ORDER.filter(
  (c): c is PositionsSortColumn => c !== "account" && c !== "syntheticShares",
);
