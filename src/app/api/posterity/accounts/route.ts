import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { POSTERITY_ACCOUNT_IDS } from "@/lib/posterity";

/**
 * Display metadata for posterity accounts (names/nicknames from `accounts` row).
 */
export async function GET() {
  try {
    const db = getDb();
    const placeholders = POSTERITY_ACCOUNT_IDS.map(() => "?").join(", ");
    const rows = db
      .prepare(`SELECT id, name, nickname FROM accounts WHERE id IN (${placeholders})`)
      .all(...POSTERITY_ACCOUNT_IDS) as Array<{ id: string; name: string; nickname: string | null }>;

    const byId = new Map(rows.map((r) => [r.id, r]));
    const accounts = POSTERITY_ACCOUNT_IDS.map((id) => {
      const r = byId.get(id);
      return {
        id,
        name: r?.name ?? id,
        nickname: r?.nickname ?? null,
      };
    });

    return NextResponse.json({ ok: true, accounts });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ ok: false, error: msg }, { status: 500 });
  }
}
