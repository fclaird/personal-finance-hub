import { NextResponse } from "next/server";
import { CountryCode, Products } from "plaid";

import { logError } from "@/lib/log";
import { getPlaidClient } from "@/lib/plaid/client";

export async function POST() {
  try {
    const client = getPlaidClient();
    const resp = await client.linkTokenCreate({
      user: { client_user_id: "local-user" },
      client_name: "Finance Hub",
      products: [Products.Investments],
      country_codes: [CountryCode.Us],
      language: "en",
    });

    const token = resp.data?.link_token;
    if (!token) {
      return NextResponse.json({ ok: false, error: "Plaid returned no link_token" }, { status: 502 });
    }

    return NextResponse.json({ ok: true, link_token: token });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("plaid_link_token_create_failed", e);
    const status =
      typeof msg === "string" &&
      /missing env var|missing env\b|PLAID_CLIENT_ID|PLAID_SECRET/i.test(msg)
        ? 503
        : 500;
    return NextResponse.json({ ok: false, error: msg }, { status });
  }
}

