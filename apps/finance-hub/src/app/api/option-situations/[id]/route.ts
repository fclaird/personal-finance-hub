import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { isAccountInFlavor } from "@/lib/flavors/accounts";
import { logError } from "@/lib/log";
import { setSituationLinkStatus } from "@/lib/situations/persistSituations";
import { resolveViewScope } from "@/lib/viewScope";

type PageProps = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, { params }: PageProps) {
  try {
    const { id } = await params;
    const body = (await req.json().catch(() => null)) as { linkStatus?: string } | null;
    if (body?.linkStatus !== "confirmed" && body?.linkStatus !== "rejected") {
      return NextResponse.json({ ok: false, error: "linkStatus must be confirmed or rejected" }, { status: 400 });
    }
    const { flavor } = await resolveViewScope();
    const db = getDb();
    const sit = db.prepare(`SELECT account_id AS accountId FROM option_situations WHERE id = ?`).get(id) as
      | { accountId: string }
      | undefined;
    if (!sit || !isAccountInFlavor(flavor, sit.accountId)) {
      return NextResponse.json({ ok: false, error: "Situation not found" }, { status: 404 });
    }
    const ok = setSituationLinkStatus(db, id, body.linkStatus);
    if (!ok) return NextResponse.json({ ok: false, error: "Situation not found" }, { status: 404 });
    return NextResponse.json({ ok: true, id, linkStatus: body.linkStatus });
  } catch (e) {
    logError("option_situation_patch_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
