/**
 * Idempotent backfill of portfolio_snapshots from existing holding_snapshots / account_value_points
 * (weekly anchors + monthly thinning for data older than 3y). Depth is limited by how far back syncs go.
 *
 * Run from repo root: npx tsx scripts/backfill-portfolio-snapshots.ts [auto|schwab]
 */
import { getDb } from "../src/lib/db";
import type { DataMode } from "../src/lib/dataMode";
import { ensureBenchmarkHistory } from "../src/lib/market/benchmarks";
import { backfillPortfolioSnapshotsFromSeries } from "../src/lib/portfolio/snapshots";

async function main() {
  const modeArg = process.argv[2]?.toLowerCase();
  const mode: DataMode = modeArg === "schwab" ? "schwab" : "auto";

  await ensureBenchmarkHistory("SPY");
  await ensureBenchmarkHistory("QQQ");

  const db = getDb();
  const n = backfillPortfolioSnapshotsFromSeries(db, mode, "backfill_holdings");
  console.log(`portfolio_snapshots: upserted ${n} row(s) (mode=${mode}).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
