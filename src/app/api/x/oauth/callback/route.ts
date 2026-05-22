import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSecretsPassphrase } from "@/lib/env";
import { exchangeXCodeForToken } from "@/lib/x/oauth";
import { setXToken } from "@/lib/x/token";
import { fetchXUserId } from "@/lib/x/client";

const STATE_COOKIE = "x_oauth_state";
const VERIFIER_COOKIE = "x_pkce_verifier";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.redirect(new URL(`/connections?x_error=${encodeURIComponent(error)}`, url));
  }
  if (!code || !state) {
    return NextResponse.redirect(new URL("/connections?x_error=missing_code", url));
  }

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  const verifier = jar.get(VERIFIER_COOKIE)?.value;
  jar.delete(STATE_COOKIE);
  jar.delete(VERIFIER_COOKIE);

  if (!expectedState || expectedState !== state || !verifier) {
    return NextResponse.redirect(new URL("/connections?x_error=invalid_state", url));
  }

  try {
    const token = await exchangeXCodeForToken(code, verifier);
    const obtained_at = Date.now();
    const access = token.access_token;
    const user_id = access ? ((await fetchXUserId(access)) ?? undefined) : undefined;
    setXToken(getSecretsPassphrase(), { ...token, obtained_at, user_id });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.redirect(new URL(`/connections?x_error=${encodeURIComponent(msg)}`, url));
  }

  jar.set("fh_x_connected", "1", {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });

  return NextResponse.redirect(new URL("/connections?x=connected", url));
}
