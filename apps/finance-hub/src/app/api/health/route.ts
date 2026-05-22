import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getDbPath } from "@/lib/paths";
import { startSchedulerOnce } from "@/lib/scheduler";

export async function GET() {
  startSchedulerOnce();
  const db = getDb();
  const row = db.prepare("SELECT name, applied_at FROM schema_migrations ORDER BY applied_at DESC LIMIT 1").get() as
    | { name: string; applied_at: string }
    | undefined;

  return NextResponse.json({
    ok: true,
    dbPath: getDbPath(),
    latestMigration: row ?? null,
  });
}

