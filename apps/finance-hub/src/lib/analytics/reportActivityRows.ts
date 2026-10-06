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
