import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { X_OAUTH_AUTHORIZE_URL, getXOAuthConfig, isXOAuthConfigured } from "@/lib/x/config";
import { newPkcePair, newState } from "@/lib/x/oauth";

const STATE_COOKIE = "x_oauth_state";
const VERIFIER_COOKIE = "x_pkce_verifier";

export async function GET() {
  if (!isXOAuthConfigured()) {
    return NextResponse.json({ ok: false, error: "X OAuth is not configured (set X_CLIENT_ID, X_CLIENT_SECRET, X_REDIRECT_URI)." }, { status: 501 });
  }

  const { clientId, redirectUri } = getXOAuthConfig();
  const state = newState();
  const { code_verifier, code_challenge } = newPkcePair();

  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });
  jar.set(VERIFIER_COOKIE, code_verifier, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });

  const u = new URL(X_OAUTH_AUTHORIZE_URL);
  u.searchParams.set("response_type", "code");
  u.searchParams.set("client_id", clientId);
  u.searchParams.set("redirect_uri", redirectUri);
  u.searchParams.set("scope", ["tweet.read", "users.read", "offline.access"].join(" "));
  u.searchParams.set("state", state);
  u.searchParams.set("code_challenge", code_challenge);
  u.searchParams.set("code_challenge_method", "S256");

  return NextResponse.redirect(u.toString());
}
