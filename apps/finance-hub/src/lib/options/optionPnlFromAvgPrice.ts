/** Per-contract mark from signed market value and quantity (always non-negative for normal positions). */
export function optionMarkPerShare(marketValue: number | null, quantity: number): number | null {
  if (marketValue == null || !Number.isFinite(marketValue) || quantity === 0) return null;
  const mark = marketValue / (quantity * 100);
  return Number.isFinite(mark) ? mark : null;
}

function optionCostBasisTotal(entryPricePerShare: number | null, quantity: number): number | null {
  if (entryPricePerShare == null || !Number.isFinite(entryPricePerShare) || quantity === 0) return null;
  return entryPricePerShare * quantity * 100;
}

/** Unrealized P/L from Schwab average entry and current position market value. */
export function optionPnlDollarsFromAvgPrice(input: {
  price: number | null;
  marketValue: number | null;
  quantity: number;
}): number | null {
  const cost = optionCostBasisTotal(input.price, input.quantity);
  if (cost == null || input.marketValue == null || !Number.isFinite(input.marketValue)) return null;
  return input.marketValue - cost;
}

/** Return on premium at risk: P/L dollars divided by absolute entry notional. */
export function optionPnlPctFromAvgPrice(input: {
  price: number | null;
  marketValue: number | null;
  quantity: number;
}): number | null {
  const pnl = optionPnlDollarsFromAvgPrice(input);
  const notional = optionCostBasisTotal(input.price, input.quantity);
  if (pnl == null || notional == null || notional === 0) return null;
  return (pnl / Math.abs(notional)) * 100;
}
