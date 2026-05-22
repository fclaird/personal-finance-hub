import { NextResponse } from "next/server";

import { getSecretsPassphrase } from "@/lib/env";
import { startSchedulerOnce } from "@/lib/scheduler";
import { getSchwabToken } from "@/lib/schwab/token";

const REFRESH_SKEW_MS = 60_000;

export async function GET() {
  try {
    startSchedulerOnce();
    const passphrase = getSecretsPassphrase();
    const tok = getSchwabToken(passphrase);
    if (!tok) {
      const resp = NextResponse.json({ ok: true, connected: false });
      resp.cookies.set("fh_schwab_connected", "0", {
        httpOnly: false,
        sameSite: "lax",
        secure: process.env.NODE_ENV === "production",
        path: "/",
        maxAge: 30 * 24 * 3600,
      });
      return resp;
    }

    const obtainedAt = tok.obtained_at;
    const expiresAt = tok.obtained_at + tok.expires_in * 1000;
    const now = Date.now();
    const accessValid = now < expiresAt - REFRESH_SKEW_MS;

    const resp = NextResponse.json({
      ok: true,
      connected: true,
      obtainedAt,
      expiresInSec: tok.expires_in,
      expiresAt,
      accessValid,
      scope: tok.scope ?? null,
      tokenType: tok.token_type ?? null,
    });
    resp.cookies.set("fh_schwab_connected", "1", {
      httpOnly: false,
      sameSite: "lax",
      secure: process.env.NODE_ENV === "production",
      path: "/",
      maxAge: 30 * 24 * 3600,
    });
    return resp;
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
