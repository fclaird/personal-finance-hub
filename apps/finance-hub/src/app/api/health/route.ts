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

  const isProd = process.env.NODE_ENV === "production";

  return NextResponse.json({
    ok: true,
    ...(isProd ? {} : { dbPath: getDbPath() }),
    latestMigration: row ?? null,
  });
}
