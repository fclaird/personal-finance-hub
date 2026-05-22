import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { accountId?: unknown; nickname?: unknown } | null;
  const accountId = typeof body?.accountId === "string" ? body.accountId.trim() : "";
  const nicknameRaw = typeof body?.nickname === "string" ? body.nickname.trim() : "";
  const nickname = nicknameRaw ? nicknameRaw.slice(0, 64) : null;

  if (!accountId) return NextResponse.json({ ok: false, error: "Missing accountId" }, { status: 400 });

  const db = getDb();
  db.prepare(`UPDATE accounts SET nickname = @nickname, updated_at = datetime('now') WHERE id = @id`).run({
    id: accountId,
    nickname,
  });

  return NextResponse.json({ ok: true, accountId, nickname });
}

