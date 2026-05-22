import { cookies } from "next/headers";
import { NextResponse } from "next/server";

import { getSecretsPassphrase } from "@/lib/env";
import { exchangeCodeForToken } from "@/lib/schwab/oauth";
import { consumeSchwabOAuthState, forgetSchwabOAuthState } from "@/lib/schwab/oauthStateMemory";
import { setSchwabToken } from "@/lib/schwab/token";

const STATE_COOKIE = "schwab_oauth_state";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return NextResponse.json({ ok: false, error }, { status: 400 });
  }
  if (!code || !state) {
    return NextResponse.json({ ok: false, error: "Missing code/state" }, { status: 400 });
  }

  const jar = await cookies();
  const expectedState = jar.get(STATE_COOKIE)?.value;
  const cookieOk = Boolean(expectedState && expectedState === state);
  let memoryOk = false;
  if (!cookieOk) {
    memoryOk = consumeSchwabOAuthState(state);
  } else {
    forgetSchwabOAuthState(state);
  }

  if (!cookieOk && !memoryOk) {
    jar.delete(STATE_COOKIE);
    return NextResponse.json({ ok: false, error: "Invalid state" }, { status: 400 });
  }

  jar.delete(STATE_COOKIE);

  const token = await exchangeCodeForToken(code);
  setSchwabToken(getSecretsPassphrase(), { ...token, obtained_at: Date.now() });

  jar.set("fh_schwab_connected", "1", {
    httpOnly: false,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 30 * 24 * 3600,
  });

  return NextResponse.redirect(new URL("/allocation", url));
}
