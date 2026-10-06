import { NextResponse } from "next/server";

import { flavorFromCookies } from "@/lib/flavorFromCookies";
import { getFlavorConfig } from "@/lib/flavors/registry";

export async function realEstateDenied(): Promise<NextResponse | null> {
  const flavor = await flavorFromCookies();
  if (getFlavorConfig(flavor).features.realEstate) return null;
  return NextResponse.json({ ok: false, error: "Real estate is on the Main flavor." }, { status: 404 });
}
