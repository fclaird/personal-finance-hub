import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { deleteManualPosition } from "@/lib/manual/manualAccounts";

type RouteCtx = { params: Promise<{ positionId: string }> };

export async function DELETE(_req: Request, ctx: RouteCtx) {
  try {
    const { positionId } = await ctx.params;
    deleteManualPosition(positionId);
    return NextResponse.json({ ok: true });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("manual_position_delete", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
