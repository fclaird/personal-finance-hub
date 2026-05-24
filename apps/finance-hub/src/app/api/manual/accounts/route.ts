import { NextResponse } from "next/server";

import { isValidAccountBucket, type AccountBucket } from "@/lib/accountBuckets";
import { logError } from "@/lib/log";
import { createManualAccount } from "@/lib/manual/manualAccounts";

export async function POST(req: Request) {
  try {
    const body = (await req.json().catch(() => null)) as {
      name?: string;
      nickname?: string | null;
      accountBucket?: AccountBucket;
    } | null;

    const name = body?.name ?? "";
    const accountBucket = body?.accountBucket ?? "brokerage";
    if (!isValidAccountBucket(accountBucket)) {
      return NextResponse.json({ ok: false, error: "Invalid account bucket" }, { status: 400 });
    }

    const account = createManualAccount({
      name,
      nickname: body?.nickname ?? null,
      accountBucket,
    });

    return NextResponse.json({ ok: true, account });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("manual_accounts_post", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
