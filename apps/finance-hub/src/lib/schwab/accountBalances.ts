export function asBalanceNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

export function pickCashUsd(cb: Record<string, unknown> | undefined): number | null {
  if (!cb) return null;
  const keys = [
    "cashBalance",
    "cashAvailableForTrading",
    "cashAvailableForWithdrawal",
    "availableFundsNonMarginableTrade",
    "availableFunds",
    "moneyMarketFund",
    "sweepVehicle",
  ];
  for (const k of keys) {
    const n = asBalanceNumber(cb[k]);
    if (n != null) return n;
  }
  return null;
}

/** Current account equity / liquidation value from Schwab balances. */
export function pickEquityUsd(cb: Record<string, unknown> | undefined): number | null {
  if (!cb) return null;
  const keys = [
    "liquidationValue",
    "netLiquidation",
    "equity",
    "equityValue",
    "accountValue",
    "totalAccountValue",
    "totalValue",
  ];
  for (const k of keys) {
    const n = asBalanceNumber(cb[k]);
    if (n != null) return n;
  }
  return null;
}

/** Prior session equity when Schwab exposes it on the balances payload. */
export function pickPriorEquityUsd(cb: Record<string, unknown> | undefined): number | null {
  if (!cb) return null;
  const keys = [
    "previousDayEquityWithLoanValue",
    "previousDayEquity",
    "previousClose",
  ];
  for (const k of keys) {
    const n = asBalanceNumber(cb[k]);
    if (n != null) return n;
  }
  return null;
}
