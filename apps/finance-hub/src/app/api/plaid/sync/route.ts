import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { getSecretsPassphrase } from "@/lib/env";
import { newId } from "@/lib/id";
import { logError } from "@/lib/log";
import { getPlaidClient } from "@/lib/plaid/client";
import { loadSecrets } from "@/lib/secrets";

type PlaidStoredItem = { access_token: string; item_id: string };

export async function POST() {
  try {
    const db = getDb();
    const client = getPlaidClient();
    const secrets = loadSecrets(getSecretsPassphrase());
    const tokens = secrets.tokens as unknown;
    const plaidBag =
      tokens && typeof tokens === "object" && "plaid" in tokens
        ? ((tokens as Record<string, unknown>).plaid as Record<string, PlaidStoredItem> | undefined)
        : undefined;

    if (!plaidBag || Object.keys(plaidBag).length === 0) {
      return NextResponse.json({ ok: false, error: "Plaid not connected yet." }, { status: 400 });
    }

  const nowIso = new Date().toISOString();

  const upsertConn = db.prepare(`
    INSERT INTO institution_connections (id, type, display_name, status, last_sync_at, updated_at)
    VALUES (@id, 'plaid', 'Plaid', 'active', @now, @now)
    ON CONFLICT(id) DO UPDATE SET last_sync_at = excluded.last_sync_at, updated_at = excluded.updated_at, status = 'active'
  `);

  const upsertAccount = db.prepare(`
    INSERT INTO accounts (id, connection_id, name, type, currency, updated_at)
    VALUES (@id, @connection_id, @name, @type, @currency, @now)
    ON CONFLICT(id) DO UPDATE SET name = excluded.name, type = excluded.type, currency = excluded.currency, updated_at = excluded.updated_at
  `);

  const upsertSecurity = db.prepare(`
    INSERT INTO securities (id, symbol, name, security_type, cusip, isin, underlying_security_id, updated_at)
    VALUES (@id, @symbol, @name, @security_type, @cusip, @isin, NULL, @now)
    ON CONFLICT(id) DO UPDATE SET symbol = excluded.symbol, name = excluded.name, cusip = excluded.cusip, isin = excluded.isin, updated_at = excluded.updated_at
  `);

  const insertSnapshot = db.prepare(`
    INSERT INTO holding_snapshots (id, account_id, as_of)
    VALUES (@id, @account_id, @as_of)
  `);

  const insertPosition = db.prepare(`
    INSERT INTO positions (id, snapshot_id, security_id, quantity, price, market_value, metadata_json)
    VALUES (@id, @snapshot_id, @security_id, @quantity, @price, @market_value, @metadata_json)
  `);

  let syncedAccounts = 0;

    for (const [itemId, item] of Object.entries(plaidBag)) {
    const connectionId = `plaid_${itemId}`;
    upsertConn.run({ id: connectionId, now: nowIso });

    const holdingsResp = await client.investmentsHoldingsGet({ access_token: item.access_token });
    const { accounts, holdings, securities } = holdingsResp.data;

    const secById = new Map(securities.map((s) => [s.security_id, s]));

    // DB writes are fast; wrap only the insert portion in a synchronous transaction.
    const tx = db.transaction(() => {
      for (const a of accounts) {
        if (!a.type) continue;
        const accountId = `plaid_${a.account_id}`;
        upsertAccount.run({
          id: accountId,
          connection_id: connectionId,
          name: a.name,
          type: a.type,
          currency: a.balances.iso_currency_code ?? "USD",
          now: nowIso,
        });
        syncedAccounts++;

        const snapshotId = newId("snap");
        insertSnapshot.run({ id: snapshotId, account_id: accountId, as_of: nowIso });

        for (const h of holdings.filter((x) => x.account_id === a.account_id)) {
          const sec = secById.get(h.security_id);
          const symbol = sec?.ticker_symbol ?? sec?.cusip ?? h.security_id;
          const securityId = `sec_${symbol}`;
          upsertSecurity.run({
            id: securityId,
            symbol,
            name: sec?.name ?? symbol,
            security_type: "other",
            cusip: sec?.cusip ?? null,
            isin: sec?.isin ?? null,
            now: nowIso,
          });
          insertPosition.run({
            id: newId("pos"),
            snapshot_id: snapshotId,
            security_id: securityId,
            quantity: h.quantity,
            price: h.institution_price ?? null,
            market_value: h.institution_value ?? null,
            metadata_json: JSON.stringify({ holding: h, security: sec }),
          });
        }
      }
    });
    tx();
  }

    return NextResponse.json({ ok: true, syncedAccounts });
  } catch (e) {
    logError("plaid_sync_failed", e);
    return NextResponse.json({ ok: false, error: e instanceof Error ? e.message : String(e) }, { status: 500 });
  }
}

