import { NextResponse } from "next/server";

import { getSecretsPassphrase } from "@/lib/env";
import { isXOAuthConfigured } from "@/lib/x/config";
import { getXToken } from "@/lib/x/token";

export async function GET() {
  if (!isXOAuthConfigured()) {
    return NextResponse.json({ ok: true, configured: false, connected: false });
  }

  try {
    const passphrase = getSecretsPassphrase();
    const t = getXToken(passphrase);
    if (!t?.access_token) {
      return NextResponse.json({ ok: true, configured: true, connected: false });
    }
    const expiresAt = t.obtained_at + (t.expires_in ?? 0) * 1000;
    return NextResponse.json({
      ok: true,
      configured: true,
      connected: true,
      obtainedAt: t.obtained_at,
      expiresAt,
      hasRefresh: Boolean(t.refresh_token),
      userId: t.user_id ?? null,
      scope: t.scope ?? null,
    });
  } catch (e) {
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}
