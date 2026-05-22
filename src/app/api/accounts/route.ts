import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";

export async function GET() {
  const db = getDb();
  const rows = db
    .prepare(
      `
      SELECT id, name, nickname, type, connection_id
      FROM accounts
      ORDER BY name ASC
    `,
    )
    .all() as Array<{ id: string; name: string; nickname: string | null; type: string; connection_id: string }>;

  return NextResponse.json({ ok: true, accounts: rows });
}

