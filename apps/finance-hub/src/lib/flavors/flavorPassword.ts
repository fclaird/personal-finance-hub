import { timingSafeEqual } from "node:crypto";

import type { FlavorId } from "@/lib/flavor";

function envFlavorPassword(flavor: FlavorId): string | null {
  const key = flavor === "main" ? "FINANCE_HUB_FLAVOR_PASSWORD_MAIN" : "FINANCE_HUB_FLAVOR_PASSWORD_RORIE";
  const v = process.env[key]?.trim();
  return v || null;
}

/** Expected password for a flavor (env-specific only; never FINANCE_HUB_PASSPHRASE). */
export function expectedFlavorPassword(flavor: FlavorId): string | null {
  return envFlavorPassword(flavor);
}

function safeEqual(a: string, b: string): boolean {
  const aa = Buffer.from(a);
  const bb = Buffer.from(b);
  if (aa.length !== bb.length) return false;
  return timingSafeEqual(aa, bb);
}

/** Returns true when password matches or no flavor password is configured (local dev). */
export function verifyFlavorPassword(flavor: FlavorId, password: string): boolean {
  const expected = expectedFlavorPassword(flavor);
  if (!expected) return true;
  return safeEqual(password, expected);
}
