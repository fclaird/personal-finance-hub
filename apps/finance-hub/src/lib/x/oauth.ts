import crypto from "node:crypto";

import { X_OAUTH_TOKEN_URL, getXOAuthConfig } from "@/lib/x/config";
import type { XToken } from "@/lib/x/token";

function base64url(buf: Buffer): string {
  return buf
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export function newPkcePair(): { code_verifier: string; code_challenge: string } {
  const code_verifier = base64url(crypto.randomBytes(32));
  const code_challenge = base64url(crypto.createHash("sha256").update(code_verifier, "utf8").digest());
  return { code_verifier, code_challenge };
}

export function newState(): string {
  return crypto.randomBytes(16).toString("hex");
}

function basicAuthHeader(clientId: string, clientSecret: string): string {
  return `Basic ${Buffer.from(`${clientId}:${clientSecret}`, "utf-8").toString("base64")}`;
}

export async function exchangeXCodeForToken(code: string, codeVerifier: string): Promise<Omit<XToken, "obtained_at" | "user_id">> {
  const { clientId, clientSecret, redirectUri } = getXOAuthConfig();
  const body = new URLSearchParams();
  body.set("grant_type", "authorization_code");
  body.set("code", code);
  body.set("redirect_uri", redirectUri);
  body.set("code_verifier", codeVerifier);
  body.set("client_id", clientId);

  const resp = await fetch(X_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`X token exchange failed: ${resp.status} ${text}`);
  }
  return (await resp.json()) as Omit<XToken, "obtained_at" | "user_id">;
}

export async function refreshXAccessToken(refreshToken: string): Promise<Omit<XToken, "obtained_at" | "user_id">> {
  const { clientId, clientSecret } = getXOAuthConfig();
  const body = new URLSearchParams();
  body.set("grant_type", "refresh_token");
  body.set("refresh_token", refreshToken);
  body.set("client_id", clientId);

  const resp = await fetch(X_OAUTH_TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      Authorization: basicAuthHeader(clientId, clientSecret),
    },
    body,
  });

  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`X token refresh failed: ${resp.status} ${text}`);
  }
  return (await resp.json()) as Omit<XToken, "obtained_at" | "user_id">;
}
