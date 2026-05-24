import { NextResponse } from "next/server";

import { isValidAccountBucket, type AccountBucket } from "@/lib/accountBuckets";
import { logError } from "@/lib/log";
import { deleteManualAccount, isManualAccountId, updateManualAccount } from "@/lib/manual/manualAccounts";

type RouteCtx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    if (!isManualAccountId(id)) {
      return NextResponse.json({ ok: false, error: "Invalid manual account id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as {
      name?: string;
      nickname?: string | null;
      accountBucket?: AccountBucket;
    } | null;

    if (body?.accountBucket != null && !isValidAccountBucket(body.accountBucket)) {
      return NextResponse.json({ ok: false, error: "Invalid account bucket" }, { status: 400 });
    }

    const account = updateManualAccount(id, {
      name: body?.name,
      nickname: body?.nickname,
      accountBucket: body?.accountBucket,
    });

    return NextResponse.json({ ok: true, account });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("manual_accounts_patch", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}

export async function DELETE(_req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    if (!isManualAccountId(id)) {
      return NextResponse.json({ ok: false, error: "Invalid manual account id" }, { status: 400 });
    }
    deleteManualAccount(id);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("manual_accounts_delete", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
