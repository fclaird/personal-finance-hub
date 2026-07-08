import { NextResponse } from "next/server";

import { logError } from "@/lib/log";
import { getDb } from "@/lib/db";
import { buildFundStatementBasis } from "@/lib/market/planFundPricing";
import {
  isManualAccountId,
  parseManualPositionMetadata,
  upsertManualPosition,
  type ManualPositionInput,
} from "@/lib/manual/manualAccounts";

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

    let fundBasis = undefined as ManualPositionInput["fundBasis"];
    if (securityType === "fund" && marketValue != null && Number.isFinite(marketValue) && marketValue > 0 && symbol) {
      const positionId = body.positionId?.trim();
      const db = getDb();
      const existing = positionId
        ? (db
            .prepare(
              `
              SELECT p.metadata_json AS metadataJson
              FROM positions p
              JOIN holding_snapshots hs ON hs.id = p.snapshot_id
              WHERE p.id = ? AND hs.account_id = ?
            `,
            )
            .get(positionId, id) as { metadataJson: string | null } | undefined)
        : undefined;
      const existingBasis = parseManualPositionMetadata(existing?.metadataJson ?? null)?.fundBasis ?? null;
      const marketValueChanged =
        existingBasis != null && existingBasis.statementMarketValue !== marketValue;
      if (!existingBasis || marketValueChanged) {
        // Statement anchor date must be when the balance was observed — not purchase date.
        const statementDate = new Date().toISOString().slice(0, 10);
        const built = await buildFundStatementBasis(symbol, marketValue, statementDate);
        if (!built) {
          return NextResponse.json(
            { ok: false, error: "Unable to anchor statement balance: fund NAV is unavailable." },
            { status: 502 },
          );
        }
        fundBasis = built;
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
