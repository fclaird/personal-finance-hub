import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { buildFundStatementBasis, shouldRebuildFundBasis } from "@/lib/market/planFundPricing";
import {
  getManualPositionFundBasis,
  isManualAccountId,
  upsertManualPosition,
  type ManualPositionInput,
} from "@/lib/manual/manualAccounts";

type RouteCtx = { params: Promise<{ id: string }> };
type ManualPositionRequest = Partial<ManualPositionInput> & {
  anchorStatementBalance?: boolean;
  statementDate?: string | null;
};

function parseStatementDate(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(trimmed) ? trimmed : null;
}

export async function POST(req: Request, ctx: RouteCtx) {
  try {
    const { id } = await ctx.params;
    if (!isManualAccountId(id)) {
      return NextResponse.json({ ok: false, error: "Invalid manual account id" }, { status: 400 });
    }

    const body = (await req.json().catch(() => null)) as ManualPositionRequest | null;
    if (!body) {
      return NextResponse.json({ ok: false, error: "Invalid body" }, { status: 400 });
    }

    const securityType = body.securityType ?? "equity";
    if (securityType !== "equity" && securityType !== "fund" && securityType !== "cash") {
      return NextResponse.json({ ok: false, error: "Invalid security type" }, { status: 400 });
    }

    const symbol = (body.symbol ?? "").trim().toUpperCase();
    const marketValue = body.marketValue != null ? Number(body.marketValue) : null;
    const statementDate = parseStatementDate(body.statementDate) ?? new Date().toISOString().slice(0, 10);
    const existingFundBasis =
      body.positionId?.trim() ? getManualPositionFundBasis(id, body.positionId.trim()) : null;

    let fundBasis = undefined as ManualPositionInput["fundBasis"];
    if (
      securityType === "fund" &&
      marketValue != null &&
      Number.isFinite(marketValue) &&
      marketValue > 0 &&
      symbol.length > 0 &&
      shouldRebuildFundBasis(existingFundBasis, marketValue, body.anchorStatementBalance === true)
    ) {
      fundBasis = await buildFundStatementBasis(symbol, marketValue, statementDate);
      if (body.anchorStatementBalance === true && !fundBasis) {
        return NextResponse.json(
          { ok: false, error: "Unable to anchor statement balance: fund NAV is unavailable." },
          { status: 502 },
        );
      }
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
