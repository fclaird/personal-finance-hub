import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { buildFundStatementBasis } from "@/lib/market/planFundPricing";
import { isManualAccountId, upsertManualPosition, type ManualPositionInput } from "@/lib/manual/manualAccounts";

type RouteCtx = { params: Promise<{ id: string }> };

export async function POST(req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    if (!isManualAccountId(id)) {
      return NextResponse.json({ ok: false, error: "Invalid manual account id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as Partial<ManualPositionInput> | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }

    const securityType = body.securityType ?? "equity";
    if (securityType !== "equity" && securityType !== "fund" && securityType !== "cash") {
      return NextResponse.json({ ok: false, error: "Invalid security type" }, { status: 400 });
    }

    const symbol = (body.symbol ?? "").trim().toUpperCase();
    const marketValue = body.marketValue != null ? Number(body.marketValue) : null;
    // Statement anchor date must be when the balance was observed — not purchase date (2011 NAV
    // would scale today's 529 balance by ~3× on every load).
    const statementDate = new Date().toISOString().slice(0, 10);

    const isNewPosition = !body.positionId?.trim();
    const anchorStatement = body.anchorStatement === true;
    let fundBasis = undefined as ManualPositionInput["fundBasis"];
    if (
      securityType === "fund" &&
      marketValue != null &&
      Number.isFinite(marketValue) &&
      marketValue > 0 &&
      symbol &&
      (anchorStatement || isNewPosition)
    ) {
      fundBasis = await buildFundStatementBasis(symbol, marketValue, statementDate);
    }

    const result = upsertManualPosition(id, {
      positionId: body.positionId,
      symbol: body.symbol ?? "",
      securityType,
      quantity: Number(body.quantity),
      purchasePrice: body.purchasePrice != null ? Number(body.purchasePrice) : null,
      marketValue,
      purchaseDate: body.purchaseDate ?? null,
      notes: body.notes ?? null,
      fundBasis,
    });

    return NextResponse.json({ ok: true, ...result });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("manual_positions_post", e);
    return NextResponse.json({ ok: false, error: msg }, { status: 400 });
  }
}
