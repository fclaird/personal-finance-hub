import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { FLAVOR_IDS, parseFlavor, type FlavorId } from "@/lib/flavor";
import { FLAVOR_REGISTRY, getFlavorConfig } from "@/lib/flavors/registry";
import { verifyFlavorPassword, expectedFlavorPassword } from "@/lib/flavors/flavorPassword";
import {
  FLAVOR_COOKIE,
  flavorCookieSecure,
  isDocumentUnlock,
  planFlavorUnlock,
  type FlavorCookieAttributes,
  type FlavorUnlockPlan,
} from "@/lib/flavors/flavorUnlockNavigation";

export async function GET() {
  const jar = await cookies();
  const flavor = parseFlavor(jar.get(FLAVOR_COOKIE)?.value);
  return NextResponse.json({
    ok: true,
    flavor,
    flavors: FLAVOR_IDS.map((id) => {
      const config = getFlavorConfig(id);
      return {
        id,
        label: config.label,
        features: config.features,
        passwordRequired: expectedFlavorPassword(id) != null,
        badgeClass: config.accent.badgeClass,
        pillActiveClass: config.accent.pillActiveClass,
      };
    }),
  });
}

function applyFlavorCookie(response: NextResponse, flavor: FlavorId, cookie: FlavorCookieAttributes) {
  response.cookies.set(FLAVOR_COOKIE, flavor, cookie);
  return response;
}

function renderUnlock(plan: FlavorUnlockPlan): NextResponse {
  if (plan.kind === "json-error") {
    return NextResponse.json({ ok: false, error: plan.error }, { status: plan.status });
  }
  if (plan.kind === "document-error") {
    return new NextResponse(null, {
      status: plan.status,
      headers: { Location: plan.location, "Cache-Control": "no-store" },
    });
  }
  if (plan.kind === "json-ok") {
    return applyFlavorCookie(
      NextResponse.json({ ok: true, flavor: plan.flavor, config: FLAVOR_REGISTRY[plan.flavor] }),
      plan.flavor,
      plan.cookie,
    );
  }
  return applyFlavorCookie(
    new NextResponse(null, {
      status: plan.status,
      headers: { Location: plan.location, "Cache-Control": "no-store" },
    }),
    plan.flavor,
    plan.cookie,
  );
}

async function readUnlockBody(req: Request): Promise<{ flavor: FlavorId | null; password: string }> {
  const contentType = req.headers.get("content-type") ?? "";
  if (contentType.includes("application/json")) {
    const body = (await req.json().catch(() => null)) as { flavor?: unknown; password?: unknown } | null;
    return {
      flavor: parseFlavor(body?.flavor),
      password: typeof body?.password === "string" ? body.password : "",
    };
  }
  const form = await req.formData().catch(() => null);
  const rawFlavor = form?.get("flavor");
  const rawPassword = form?.get("password");
  return {
    flavor: parseFlavor(typeof rawFlavor === "string" ? rawFlavor : null),
    password: typeof rawPassword === "string" ? rawPassword : "",
  };
}

export async function POST(req: Request) {
  const { flavor, password } = await readUnlockBody(req);
  const plan = planFlavorUnlock({
    document: isDocumentUnlock(req),
    flavor,
    passwordOk: flavor != null && verifyFlavorPassword(flavor, password),
    secure: flavorCookieSecure(req),
  });
  return renderUnlock(plan);
}
