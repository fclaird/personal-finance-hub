import { getDb } from "@/lib/db";
import { glanceSessionYmd } from "@/lib/market/glanceSession";
import { pickEquityUsd, pickSchwabPriorDayEquityUsd } from "@/lib/schwab/accountBalances";
import { schwabFetch } from "@/lib/schwab/client";
import {
  priorNySessionYmd,
  schwabIntradayTotalsFromDb,
  schwabLiquidationFromDb,
  schwabPriorLiquidationFromDb,
} from "@/lib/terminal/portfolioAccountTotals";

async function main() {
  const db = getDb();
  const now = new Date();
  const sessionYmd = glanceSessionYmd(now);
  const priorYmd = priorNySessionYmd(sessionYmd);
  const intraday = schwabIntradayTotalsFromDb(db, sessionYmd);
  const dbCur = schwabLiquidationFromDb(db);
  const dbPrior = schwabPriorLiquidationFromDb(db, priorYmd);

  console.log("sessionYmd", sessionYmd, "priorYmd", priorYmd);
  console.log("intraday count", intraday.length);
  if (intraday.length) {
    const first = intraday[0]!;
    const last = intraday[intraday.length - 1]!;
    console.log("intraday first", first.total, new Date(first.tsMs).toISOString());
    console.log("intraday last", last.total, new Date(last.tsMs).toISOString());
    console.log("pct vs first intraday", ((last.total / first.total - 1) * 100).toFixed(3));
  }
  console.log("db current", dbCur.current, "db prior", dbPrior.prior);
  for (const [k, v] of dbCur.byAccount) {
    const p = dbPrior.byAccount.get(k);
    console.log("DB", k, "cur", v.toFixed(2), "prior", p?.toFixed(2), "pct", p ? ((v / p - 1) * 100).toFixed(3) : "n/a");
  }

  const accounts = await schwabFetch<
    Array<{ securitiesAccount: { accountId?: string; accountNumber?: string; currentBalances?: Record<string, unknown> } }>
  >("accounts");
  let cur = 0;
  let pri = 0;
  for (const a of accounts) {
    const sa = a.securitiesAccount;
    const id = sa.accountId ?? sa.accountNumber;
    const eq = pickEquityUsd(sa.currentBalances);
    const p = pickSchwabPriorDayEquityUsd(sa.currentBalances);
    if (eq == null) continue;
    cur += eq;
    if (p) pri += p;
    console.log(
      "LIVE",
      id,
      "liq",
      eq.toFixed(2),
      "prevPDE",
      p?.toFixed(2),
      "dayPct",
      p ? ((eq / p - 1) * 100).toFixed(3) : "n/a",
    );
  }
  console.log("LIVE totals", cur.toFixed(2), pri.toFixed(2), "pct", ((cur / pri - 1) * 100).toFixed(3));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
