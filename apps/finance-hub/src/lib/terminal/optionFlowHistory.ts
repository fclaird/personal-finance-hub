import { getDb } from "@/lib/db";
import { nyYmd } from "@/lib/market/usEquitySession";

const PROVIDER = "schwab";

export function optionFlowSessionDate(now: Date = new Date()): string {
  return nyYmd(now);
}

export function recordOptionFlowVolumes(volumes: Map<string, number>, sessionDate: string): void {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO option_flow_daily (provider, symbol, session_date, total_volume, updated_at)
    VALUES (@provider, @symbol, @sessionDate, @volume, datetime('now'))
    ON CONFLICT(provider, symbol, session_date) DO UPDATE SET
      total_volume = excluded.total_volume,
      updated_at = excluded.updated_at
  `);
  const tx = db.transaction(() => {
    for (const [symbol, volume] of volumes) {
      if (!Number.isFinite(volume) || volume <= 0) continue;
      stmt.run({
        provider: PROVIDER,
        symbol: symbol.trim().toUpperCase(),
        sessionDate,
        volume,
      });
    }
  });
  tx();
}

/** Trailing average of completed sessions before \`beforeSessionDate\`. */
export function trailingAvgOptionVolume(symbol: string, beforeSessionDate: string, days = 20): number | null {
  const db = getDb();
  const sym = symbol.trim().toUpperCase();
  const rows = db
    .prepare(
      `
      SELECT total_volume AS volume
      FROM option_flow_daily
      WHERE provider=? AND symbol=? AND session_date < ?
      ORDER BY session_date DESC
      LIMIT ?
    `,
    )
    .all(PROVIDER, sym, beforeSessionDate, days) as Array<{ volume: number }>;

  if (rows.length < Math.min(5, days)) return null;
  const avg = rows.reduce((sum, row) => sum + row.volume, 0) / rows.length;
  return Number.isFinite(avg) && avg > 0 ? avg : null;
}
