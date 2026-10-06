import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { buildRealEstatePayload } from "@/lib/realEstate/monthly";
import { realEstateDenied } from "@/lib/realEstate/access";
import { deleteLoanPayment, parsePaymentPayload, updateLoanPayment, upsertLoanPayments } from "@/lib/realEstate/store";

function failure(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  return NextResponse.json({ ok: false, error: message }, { status: message === "Payment not found" ? 404 : 400 });
}

export async function POST(req: Request) {
  const denied = await realEstateDenied();
  if (denied) return denied;
  const parsed = parsePaymentPayload(await req.json().catch(() => null));
  if ("error" in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  try {
    const ids = upsertLoanPayments(getDb(), parsed.propertyId, parsed.payments);
    const dashboard = await buildRealEstatePayload();
    return NextResponse.json({ ...dashboard, ids });
  } catch (error) {
    return failure(error);
  }
}

export async function PATCH(req: Request) {
  const denied = await realEstateDenied();
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const id = typeof body?.id === "string" ? body.id.trim() : "";
  if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  const parsed = parsePaymentPayload({ ...(body ?? {}), propertyId: "re_crownsville" });
  if ("error" in parsed) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 });
  const payment = parsed.payments[0];
  if (!payment) return NextResponse.json({ ok: false, error: "Payment fields are required" }, { status: 400 });
  try {
    updateLoanPayment(getDb(), id, payment);
    return NextResponse.json(await buildRealEstatePayload());
  } catch (error) {
    return failure(error);
  }
}

export async function DELETE(req: Request) {
  const denied = await realEstateDenied();
  if (denied) return denied;
  const url = new URL(req.url);
  const body = (await req.json().catch(() => null)) as { id?: unknown } | null;
  const id = (typeof body?.id === "string" ? body.id : url.searchParams.get("id") ?? "").trim();
  if (!id) return NextResponse.json({ ok: false, error: "id is required" }, { status: 400 });
  try {
    deleteLoanPayment(getDb(), id);
    return NextResponse.json(await buildRealEstatePayload());
  } catch (error) {
    return failure(error);
  }
}
