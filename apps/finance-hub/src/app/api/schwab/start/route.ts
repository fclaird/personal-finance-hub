import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { buildSchwabAuthorizeUrl, newState } from "@/lib/schwab/oauth";
import { rememberSchwabOAuthState } from "@/lib/schwab/oauthStateMemory";

const STATE_COOKIE = "schwab_oauth_state";

export async function GET() {
  const state = newState();
  rememberSchwabOAuthState(state);
  const jar = await cookies();
  jar.set(STATE_COOKIE, state, {
    httpOnly: true,
    sameSite: "lax",
    // In local dev, Next may run over http unless you opt into HTTPS.
    // If `secure: true` on http, the browser will silently drop the cookie and OAuth will fail state validation.
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 10 * 60,
  });

  return NextResponse.redirect(buildSchwabAuthorizeUrl(state));
}

