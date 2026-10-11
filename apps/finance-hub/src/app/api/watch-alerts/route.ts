import { NextResponse } from "next/server";

import { deleteWatchAlert, insertWatchAlert, listWatchAlerts, setWatchAlertEnabled } from "@/lib/alerts/watchAlertStore";
import type { ProfitTargetConfig, WatchAlertKind } from "@/lib/alerts/watchAlerts";
import { getDb } from "@/lib/db";

function isKind(value: unknown): value is WatchAlertKind {
  return value === "price" || value === "iv-spike" || value === "profit-target";
}

export async function GET() {
  try {
    return NextResponse.json({ ok: true, alerts: listWatchAlerts(getDb()) });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ ok: false, error: message, alerts: [] }, { status: 500 });
  }
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as {
    id?: string;
    enabled?: boolean;
    kind?: string;
    symbol?: string;
    direction?: string;
    level?: number;
    minRankPct?: number;
    targetPnl?: number;
    expiry?: string;
  } | null;
  if (!body) return NextResponse.json({ ok: false, error: "Missing body" }, { status: 400 });
  const db = getDb();
  if (body.id && typeof body.enabled === "boolean") {
    const updated = setWatchAlertEnabled(db, body.id, body.enabled);
    if (!updated) return NextResponse.json({ ok: false, error: "Alert not found" }, { status: 404 });
    return NextResponse.json({ ok: true, alerts: listWatchAlerts(db) });
  }
  if (!isKind(body.kind) || !body.symbol) {
    return NextResponse.json({ ok: false, error: "Need a kind and a symbol." }, { status: 400 });
  }
  const saved =
    body.kind === "price"
      ? insertWatchAlert(db, {
          kind: "price",
          symbol: body.symbol,
          config: { direction: body.direction === "below" ? "below" : "above", level: Number(body.level) },
        })
      : body.kind === "iv-spike"
        ? insertWatchAlert(db, { kind: "iv-spike", symbol: body.symbol, config: { minRankPct: Number(body.minRankPct) } })
        : insertWatchAlert(db, {
            kind: "profit-target",
            symbol: body.symbol,
            config: {
              targetPnl: Number(body.targetPnl),
              ...(typeof body.expiry === "string" && /^\d{4}-\d{2}-\d{2}$/.test(body.expiry) ? { expiry: body.expiry } : {}),
            } satisfies ProfitTargetConfig,
          });
  if (!saved) return NextResponse.json({ ok: false, error: "Check the symbol and the threshold." }, { status: 400 });
  return NextResponse.json({ ok: true, alert: saved, alerts: listWatchAlerts(db) });
}

export async function DELETE(req: Request) {
  const id = new URL(req.url).searchParams.get("id") ?? "";
  if (!id) return NextResponse.json({ ok: false, error: "Missing id" }, { status: 400 });
  const removed = deleteWatchAlert(getDb(), id);
  if (!removed) return NextResponse.json({ ok: false, error: "Alert not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
