import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { readWalFileBytes } from "@/lib/dbPragmas";
import { buildHealthReport, readProcessVitals } from "@/lib/healthReport";
import { getDbPath } from "@/lib/paths";
import { schedulerDebugState, startSchedulerOnce } from "@/lib/scheduler";

export async function GET() {
  startSchedulerOnce();
  const db = getDb();
  const row = db.prepare("SELECT name, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 1").get() as
    | { name: string; applied_at: string }
    | undefined;

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
      latestMigration: row ?? null,
      walBytes: readWalFileBytes(getDbPath()),
      dbPath: isProd ? null : getDbPath(),
    }),
  );
}
