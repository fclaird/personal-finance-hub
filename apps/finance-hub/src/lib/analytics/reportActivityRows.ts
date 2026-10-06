/**
 * Rows are oldest first. Returns the latest key whose trade count is above zero.
 * The weekly tab uses this to open the most recent day that has trades.
 */
export function mostRecentActiveKey(rows: readonly { key: string; tradeCount: number }[]): string | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row && row.tradeCount > 0) return row.key;
  }
  return null;
}

/** Closing trades, counted the same way the daily list counts rows. */
export function tradeCountLabel(count: number): string {
  return count === 1 ? "1 trade" : `${count} trades`;
}

/** Positive realized closes are wins. Negative closes are losses. Zero and blank dollars are neither. */
export function winLossLabel(trades: readonly { realizedDollars: number | null }[]): string {
  let wins = 0;
  let losses = 0;
  for (const trade of trades) {
    const dollars = trade.realizedDollars;
    if (dollars == null || !Number.isFinite(dollars) || dollars === 0) continue;
    if (dollars > 0) wins += 1;
    else losses += 1;
  }
  return `${wins}W / ${losses}L`;
}
