import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";
import { DEFAULT_TRANSACTION_LOOKBACK_DAYS } from "@/lib/schwab/config";
import { fetchSchwabAccountNumbers, fetchSchwabTransactionsChunked } from "@/lib/schwab/fetchAccountTransactions";
import { normalizeSchwabTransaction } from "@/lib/schwab/transactionNormalize";
import { reclassifyBrokerTransactionRow } from "@/lib/strategy/classifyTransaction";

export type SyncBrokerTransactionsResult = {
  ok: true;
  lookbackDays: number;
  accountsUpdated: number;
  transactionsUpserted: number;
  classified: number;
};

function upsertTransaction(
  db: Database.Database,
  params: {
    id: string;
    account_id: string;
    external_activity_id: string;
    trade_date: string;
    transaction_type: string | null;
    description: string | null;
    net_amount: number | null;
    raw_json: string;
    symbol: string | null;
    underlying_symbol: string | null;
    asset_type: string | null;
    instruction: string | null;
    position_effect: string | null;
    quantity: number | null;
    price: number | null;
    option_expiration: string | null;
    option_right: string | null;
    option_strike: number | null;
    leg_count: number;
    now: string;
  },
): string {
  const existing = db
    .prepare(
      `SELECT id FROM broker_transactions WHERE account_id = @account_id AND external_activity_id = @external_activity_id`,
    )
    .get({
      account_id: params.account_id,
      external_activity_id: params.external_activity_id,
    }) as { id: string } | undefined;

  const id = existing?.id ?? params.id;

  db.prepare(
    `
    INSERT INTO broker_transactions (
      id, account_id, external_activity_id, trade_date, transaction_type, description, net_amount,
      raw_json, symbol, underlying_symbol, asset_type, instruction, position_effect, quantity, price,
      option_expiration, option_right, option_strike, leg_count, strategy_category, classified_at, updated_at
    ) VALUES (
      @id, @account_id, @external_activity_id, @trade_date, @transaction_type, @description, @net_amount,
      @raw_json, @symbol, @underlying_symbol, @asset_type, @instruction, @position_effect, @quantity, @price,
      @option_expiration, @option_right, @option_strike, @leg_count, NULL, NULL, @now
    )
    ON CONFLICT(account_id, external_activity_id) DO UPDATE SET
      trade_date = excluded.trade_date,
      transaction_type = excluded.transaction_type,
      description = excluded.description,
      net_amount = excluded.net_amount,
      raw_json = excluded.raw_json,
      symbol = excluded.symbol,
      underlying_symbol = excluded.underlying_symbol,
      asset_type = excluded.asset_type,
      instruction = excluded.instruction,
      position_effect = excluded.position_effect,
      quantity = excluded.quantity,
      price = excluded.price,
      option_expiration = excluded.option_expiration,
      option_right = excluded.option_right,
      option_strike = excluded.option_strike,
      leg_count = excluded.leg_count,
      updated_at = excluded.updated_at
  `,
  ).run({ ...params, id });

  const row = db
    .prepare(
      `SELECT id FROM broker_transactions WHERE account_id = @account_id AND external_activity_id = @external_activity_id`,
    )
    .get({
      account_id: params.account_id,
      external_activity_id: params.external_activity_id,
    }) as { id: string };
  return row.id;
}

/**
 * Sync TRADE transactions from Schwab into `broker_transactions`, update account hash map, reclassify rows touched.
 */
export async function syncSchwabBrokerTransactions(options?: {
  lookbackDays?: number;
  db?: Database.Database;
}): Promise<SyncBrokerTransactionsResult> {
  const db = options?.db ?? getDb();
  const lookbackDays = options?.lookbackDays ?? DEFAULT_TRANSACTION_LOOKBACK_DAYS;
  const now = new Date().toISOString();

  const nums = await fetchSchwabAccountNumbers();
  const updateHash = db.prepare(
    `UPDATE accounts SET schwab_account_hash = @hash, updated_at = @now WHERE id = @id`,
  );

  let accountsUpdated = 0;
  const accountHashes: { accountId: string; hash: string }[] = [];

  for (const n of nums) {
    const num = (n.accountNumber ?? "").trim();
    const hash = (n.hashValue ?? "").trim();
    if (!num || !hash) continue;
    const localId = `schwab_${num}`;
    const acc = db.prepare(`SELECT 1 AS ok FROM accounts WHERE id = ?`).get(localId) as { ok: number } | undefined;
    if (!acc) continue;
    updateHash.run({ hash, now, id: localId });
    accountsUpdated++;
    accountHashes.push({ accountId: localId, hash });
  }

  let transactionsUpserted = 0;
  const touchedIds = new Set<string>();

  for (const { accountId, hash } of accountHashes) {
    const txs = await fetchSchwabTransactionsChunked(hash, lookbackDays);
    for (const tx of txs) {
      const norm = normalizeSchwabTransaction(tx);
      if (!norm) continue;
      const rowId = newId("btx");
      const id = upsertTransaction(db, {
        id: rowId,
        account_id: accountId,
        external_activity_id: norm.external_activity_id,
        trade_date: norm.trade_date,
        transaction_type: norm.transaction_type,
        description: norm.description,
        net_amount: norm.net_amount,
        raw_json: norm.raw_json,
        symbol: norm.symbol,
        underlying_symbol: norm.underlying_symbol,
        asset_type: norm.asset_type,
        instruction: norm.instruction,
        position_effect: norm.position_effect,
        quantity: norm.quantity,
        price: norm.price,
        option_expiration: norm.option_expiration,
        option_right: norm.option_right,
        option_strike: norm.option_strike,
        leg_count: norm.leg_count,
        now,
      });
      transactionsUpserted++;
      touchedIds.add(id);
    }
  }

  let classified = 0;
  for (const id of touchedIds) {
    reclassifyBrokerTransactionRow(db, id);
    classified++;
  }

  return { ok: true, lookbackDays, accountsUpdated, transactionsUpserted, classified };
}
