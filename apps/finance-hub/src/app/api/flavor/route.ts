import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { FLAVOR_COOKIE, FLAVOR_IDS, parseFlavor, type FlavorId } from "@/lib/flavor";
import { FLAVOR_REGISTRY, getFlavorConfig } from "@/lib/flavors/registry";
import { verifyFlavorPassword, expectedFlavorPassword } from "@/lib/flavors/flavorPassword";

export async function GET() {
  const jar = await cookies();
  const flavor = parseFlavor(jar.get(FLAVOR_COOKIE)?.value);
  return NextResponse.json({
    ok: true,
    flavor,
    flavors: FLAVOR_IDS.map((id) => ({
      id,
      label: getFlavorConfig(id).label,
      features: getFlavorConfig(id).features,
      passwordRequired: expectedFlavorPassword(id) != null,
    })),
  });
}

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { flavor?: unknown; password?: unknown } | null;
  const flavor: FlavorId | null = parseFlavor(body?.flavor);
  const password = typeof body?.password === "string" ? body.password : "";
  if (!flavor) {
    return NextResponse.json({ ok: false, error: "Invalid flavor" }, { status: 400 });
  }

  if (!verifyFlavorPassword(flavor, password)) {
    return NextResponse.json({ ok: false, error: "Incorrect password" }, { status: 401 });
  }

  const jar = await cookies();
  jar.set(FLAVOR_COOKIE, flavor, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 365 * 24 * 3600,
  });

  return NextResponse.json({ ok: true, flavor, config: FLAVOR_REGISTRY[flavor] });
}
