/** Opt-in API key auth for LAN/VPN exposure. When FINANCE_HUB_API_KEY is unset, all routes remain open (localhost trust). */

import { authorizeCronRequest } from "@/lib/internalCronAuth";

/** Constant-time compare (Edge-safe — middleware cannot import node:crypto). */
function safeEqual(a: string, b: string): boolean {
  const aa = new TextEncoder().encode(a);
  const bb = new TextEncoder().encode(b);
  if (aa.length !== bb.length) return false;
  let diff = 0;
  for (let i = 0; i < aa.length; i++) diff |= aa[i]! ^ bb[i]!;
  return diff === 0;
}

export function apiAuthRequired(): boolean {
  return Boolean(process.env.FINANCE_HUB_API_KEY?.trim());
}

export function getConfiguredApiKey(): string | null {
  return process.env.FINANCE_HUB_API_KEY?.trim() || null;
}

export function isApiAuthExemptPath(pathname: string): boolean {
  const exempt = [
    "/api/schwab/start",
    "/api/schwab/callback",
    "/api/x/oauth/start",
    "/api/x/oauth/callback",
    "/api/auth/config",
  ];
  return exempt.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

/** Routes that enforce CRON_SECRET in the handler (also accepted at middleware when LAN auth is on). */
export function isCronProtectedApiPath(pathname: string): boolean {
  if (pathname.startsWith("/api/internal/")) return true;
  return pathname === "/api/news/ingest";
}

export function getApiKeyFromRequest(req: Request): string | null {
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Bearer ")) {
    const token = auth.slice(7).trim();
    if (token) return token;
  }
  const header = req.headers.get("x-finance-hub-key")?.trim();
  return header || null;
}

export function authorizeApiRequest(req: Request): boolean {
  if (!apiAuthRequired()) return true;
  const pathname = new URL(req.url).pathname;
  if (isApiAuthExemptPath(pathname)) return true;
  if (isCronProtectedApiPath(pathname) && authorizeCronRequest(req)) return true;
  const expected = getConfiguredApiKey();
  if (!expected) return true;
  const provided = getApiKeyFromRequest(req);
  if (!provided) return false;
  return safeEqual(provided, expected);
}
