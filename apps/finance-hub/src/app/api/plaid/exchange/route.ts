import { NextResponse } from "next/server";

import { getSecretsPassphrase } from "@/lib/env";
import { getPlaidClient } from "@/lib/plaid/client";
import { loadSecrets, saveSecrets } from "@/lib/secrets";

export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { public_token?: string } | null;
  const publicToken = body?.public_token;
  if (!publicToken) return NextResponse.json({ ok: false, error: "Missing public_token" }, { status: 400 });

  const client = getPlaidClient();
  const resp = await client.itemPublicTokenExchange({ public_token: publicToken });
  const { access_token, item_id } = resp.data;

  const passphrase = getSecretsPassphrase();
  const secrets = loadSecrets(passphrase);
  const tokens = (secrets.tokens ?? {}) as Record<string, unknown>;
  const plaidBag = (tokens.plaid ?? {}) as Record<string, unknown>;
  plaidBag[item_id] = { access_token, item_id, obtained_at: Date.now() };
  tokens.plaid = plaidBag;
  saveSecrets(passphrase, { ...secrets, tokens });

  return NextResponse.json({ ok: true, item_id });
}

