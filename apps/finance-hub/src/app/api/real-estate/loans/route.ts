import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { buildRealEstatePayload } from "@/lib/realEstate/monthly";
import { saveLoanTerms } from "@/lib/realEstate/store";
import { normalizeAnnualRate } from "@/lib/realEstate/loans";
import { realEstateDenied } from "@/lib/realEstate/access";

function num(value: unknown): number | null {
  if (value == null || value === "") return null;
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : null;
}

function str(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed || null;
}

export async function POST(req: Request) {
  const denied = await realEstateDenied();
  if (denied) return denied;
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const propertyId = str(body?.propertyId);
  if (!propertyId) return NextResponse.json({ ok: false, error: "propertyId is required" }, { status: 400 });
  const rawRate = num(body?.interestRate);
  const annualRate = rawRate == null ? null : normalizeAnnualRate(rawRate);
  if (rawRate != null && annualRate == null) {
    return NextResponse.json({ ok: false, error: "interestRate must be a decimal like 0.065, or a percent like 6.5" }, { status: 400 });
  }
  const startDate = str(body?.startDate);
  if (startDate && !/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return NextResponse.json({ ok: false, error: "startDate must be YYYY-MM-DD" }, { status: 400 });
  }
  try {
    saveLoanTerms(getDb(), {
      propertyId,
      lender: str(body?.lender),
      originalPrincipal: num(body?.originalPrincipal),
      annualRate,
      termMonths: num(body?.termMonths),
      startDate,
      monthlyPayment: num(body?.monthlyPayment),
    });
    return NextResponse.json(await buildRealEstatePayload());
  } catch (error) {
    return NextResponse.json(
      { ok: false, error: error instanceof Error ? error.message : String(error) },
      { status: 400 },
    );
  }
}
