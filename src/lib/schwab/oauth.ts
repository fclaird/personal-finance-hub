import crypto from "node:crypto";

import { SCHWAB_OAUTH_AUTHORIZE_URL, SCHWAB_OAUTH_TOKEN_URL, getSchwabConfig } from "@/lib/schwab/config";
import type { SchwabToken } from "@/lib/schwab/token";

/** Authorization-code exchange must return both tokens (snake_case or camelCase). */
function parseSchwabTokenFromExchange(json: unknown): Omit<SchwabToken, "obtained_at"> {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const access_token = String(j.access_token ?? j.accessToken ?? "");
  const refresh_token = String(j.refresh_token ?? j.refreshToken ?? "");
  const token_type = String(j.token_type ?? j.tokenType ?? "Bearer");
  const expRaw = j.expires_in ?? j.expiresIn ?? 1800;
  const expires_in =
    typeof expRaw === "number" && Number.isFinite(expRaw) ? expRaw : Number(String(expRaw)) || 1800;
  const scope = j.scope != null ? String(j.scope) : undefined;
  if (!access_token) throw new Error("Schwab token exchange: missing access_token");
  if (!refresh_token) throw new Error("Schwab token exchange: missing refresh_token");
  return { access_token, refresh_token, token_type, expires_in, scope };
}

/**
 * Refresh responses often include a new access token only; keep prior refresh_token when omitted.
 */
function parseSchwabTokenFromRefresh(json: unknown, priorRefresh: string): Omit<SchwabToken, "obtained_at"> {
  const j = (json && typeof json === "object" ? json : {}) as Record<string, unknown>;
  const access_token = String(j.access_token ?? j.accessToken ?? "");
  const fromBody = String(j.refresh_token ?? j.refreshToken ?? "");
  const refresh_token = fromBody || priorRefresh;
  const token_type = String(j.token_type ?? j.tokenType ?? "Bearer");
  const expRaw = j.expires_in ?? j.expiresIn ?? 1800;
  const expires_in =
    typeof expRaw === "number" && Number.isFinite(expRaw) ? expRaw : Number(String(expRaw)) || 1800;
  const scope = j.scope != null ? String(j.scope) : undefined;
  if (!access_token) throw new Error("Schwab token refresh: missing access_token");
  if (!refresh_token) throw new Error("Schwab token refresh: missing refresh_token");
  return { access_token, refresh_token, token_type, expires_in, scope };
}

export function buildSchwabAuthorizeUrl(state: string): string {
  const { clientId, redirectUri } = getSchwabConfig();
  const url = new URL(SCHWAB_OAUTH_AUTHORIZE_URL);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("state", state);
  return url.toString();
}

export function newState(): string {
  return crypto.randomBytes(16).toString("hex");
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf-8").toString("base64")}`;
}

export async function exchangeCodeForToken(code: string): Promise<Omit<SchwabToken, "obtained_at">> {
  const { clientId, clientSecret, redirectUri } = getSchwabConfig();
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);

  const resp = await fetch(SCHWAB_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Schwab token exchange failed: ${resp.status} ${resp.statusText} ${text}`);
  }
  return parseSchwabTokenFromExchange(await resp.json());
}

/** True when Schwab will not accept this refresh token again (reconnect required). */
export function isSchwabRefreshTokenRejectedMessage(message: string): boolean {
  return (
    /refresh_token_authentication_error/i.test(message) ||
    /Failed refresh token authentication/i.test(message) ||
    /invalid[_ ]?grant/i.test(message)
  );
}

export async function refreshToken(refresh_token: string): Promise<Omit<SchwabToken, "obtained_at">> {
  const { clientId, clientSecret } = getSchwabConfig();
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refresh_token);

  const resp = await fetch(SCHWAB_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      Authorization: basicAuthHeader(clientId, clientSecret),
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Schwab token refresh failed: ${resp.status} ${resp.statusText} ${text}`);
  }
  return parseSchwabTokenFromRefresh(await resp.json(), refresh_token);
}

