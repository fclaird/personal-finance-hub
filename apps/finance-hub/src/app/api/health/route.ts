import { NextResponse } from "next/server";

import { readCachedLatestMigration } from "@/lib/db";
import { readWalFileBytes } from "@/lib/dbPragmas";
import { buildHealthReport, readProcessVitals } from "@/lib/healthReport";
import { getDbPath } from "@/lib/paths";
import { quoteCacheSize } from "@/lib/schwab/quotesFetch";
import { schedulerDebugState, startSchedulerOnce } from "@/lib/scheduler";

export async function GET() {
  startSchedulerOnce();
  // Memory and a WAL stat only. A schema query here waited behind whatever
  // better-sqlite3 call was already on this thread, so three probes timed out
  // together and the watchdog restarted the server.

  const isProd = process.env.NODE_ENV === "production";
  const scheduler = schedulerDebugState();

  return NextResponse.json(
    buildHealthReport({
      vitals: readProcessVitals(),
      scheduler: {
        started: scheduler.started,
        inFlight: scheduler.inFlight,
        overlapSkips: scheduler.overlapSkips,
        ticksStarted: scheduler.ticksStarted,
        lastTickAt: scheduler.lastTickAt,
        lastSlowRunAt: scheduler.lastSlowRunAt,
        lastAccountValueRunAt: scheduler.lastAccountValueRunAt,
      },
      latestMigration: readCachedLatestMigration(),
      walBytes: readWalFileBytes(getDbPath()),
      quoteCacheEntries: quoteCacheSize(),
      dbPath: isProd ? null : getDbPath(),
    }),
  );
}
