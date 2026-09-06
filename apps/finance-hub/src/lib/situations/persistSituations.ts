import type Database from "better-sqlite3";

import { newId } from "@/lib/id";
import { clumpLinkablePartials, loadLinkableBrokerTransactions } from "@/lib/situations/fromBrokerTx";
import { proposeSituations } from "@/lib/situations/linkSituations";
import type { ProposedSituation, SituationLinkStatus, SituationMemberRole } from "@/lib/situations/types";
import { hasCoveringShares } from "@/lib/strategy/equityCoverage";
import { deltaAtFillFromDb } from "@/lib/situations/fillDelta";

export type SituationListRow = {
  id: string;
  accountId: string;
  accountName: string;
  underlying: string;
  kind: string;
  status: string;
  linkStatus: SituationLinkStatus;
  openedOn: string;
  closedOn: string | null;
  netPremium: number | null;
  title: string;
  members: Array<{
    transactionId: string;
    role: SituationMemberRole;
    tradeDate: string;
    tradeTime: string | null;
    symbol: string | null;
    underlying: string | null;
    expiration: string | null;
    right: "C" | "P" | null;
    strike: number | null;
    price: number | null;
    quantity: number | null;
    positionEffect: string | null;
    netAmount: number | null;
    instruction: string | null;
    description: string | null;
    orderId: string | null;
    deltaAtFill: number | null;
  }>;
};

function loadRejectedPairs(db: Database.Database): Array<[string, string]> {
  const rows = db
    .prepare(`SELECT transaction_id_a AS a, transaction_id_b AS b FROM option_situation_rejections`)
    .all() as Array<{ a: string; b: string }>;
  return rows.map((r) => [r.a, r.b]);
}

function coveredCallTxnIds(db: Database.Database, txns: ReturnType<typeof loadLinkableBrokerTransactions>): Set<string> {
  const out = new Set<string>();
  for (const t of txns) {
    const leg = t.legs.find((l) => l.right === "C" && l.opening);
    if (!leg) continue;
    if (hasCoveringShares(db, t.accountId, t.legs[0]?.underlying ?? "", Math.abs(leg.quantity ?? 1), t.tradeDate)) {
      out.add(t.id);
    }
  }
  return out;
}

/** Rebuild auto/proposed situations. Confirmed and rejected rows are left intact. */
export function rebuildAutoSituations(db: Database.Database): { proposed: number; kept: number } {
  const lockedIds = new Set(
    (
      db
        .prepare(
          `
          SELECT m.transaction_id AS id
          FROM option_situation_members m
          JOIN option_situations s ON s.id = m.situation_id
          WHERE s.link_status IN ('confirmed', 'rejected')
        `,
        )
        .all() as { id: string }[]
    ).map((r) => r.id),
  );

  const kept = (
    db
      .prepare(`SELECT COUNT(*) AS c FROM option_situations WHERE link_status IN ('confirmed', 'rejected')`)
      .get() as { c: number }
  ).c;

  db.exec(`
    DELETE FROM option_situations
    WHERE link_status IN ('auto', 'proposed')
  `);

  const rawTxns = loadLinkableBrokerTransactions(db).filter((t) => !lockedIds.has(t.id));
  const allTxns = clumpLinkablePartials(rawTxns);
  const sourceIdsByPrimary = new Map<string, string[]>();
  for (const t of allTxns) {
    sourceIdsByPrimary.set(t.id, t.sourceTransactionIds?.length ? t.sourceTransactionIds : [t.id]);
  }
  const proposed = proposeSituations(allTxns, {
    rejectedPairs: loadRejectedPairs(db),
    coveredCallTxnIds: coveredCallTxnIds(db, allTxns),
  });

  const now = new Date().toISOString();
  const insertSit = db.prepare(
    `
    INSERT INTO option_situations (
      id, account_id, underlying_symbol, kind, status, link_status,
      opened_on, closed_on, net_premium, title, created_at, updated_at
    ) VALUES (
      @id, @accountId, @underlying, @kind, @status, @linkStatus,
      @openedOn, @closedOn, @netPremium, @title, @now, @now
    )
  `,
  );
  const insertMember = db.prepare(
    `
    INSERT INTO option_situation_members (situation_id, transaction_id, role)
    VALUES (@situationId, @transactionId, @role)
  `,
  );

  const write = db.transaction((rows: ProposedSituation[]) => {
    for (const s of rows) {
      const id = newId("sit");
      insertSit.run({
        id,
        accountId: s.accountId,
        underlying: s.underlying,
        kind: s.kind,
        status: s.status,
        linkStatus: s.linkStatus,
        openedOn: s.openedOn,
        closedOn: s.closedOn,
        netPremium: s.netPremium,
        title: s.title,
        now,
      });
      for (const m of s.members) {
        const sources = sourceIdsByPrimary.get(m.transactionId) ?? [m.transactionId];
        for (const transactionId of sources) {
          insertMember.run({ situationId: id, transactionId, role: m.role });
        }
      }
    }
  });
  write(proposed);
  return { proposed: proposed.length, kept };
}

export function listSituations(db: Database.Database): SituationListRow[] {
  const sits = db
    .prepare(
      `
      SELECT
        s.id, s.account_id AS accountId, a.name AS accountName,
        s.underlying_symbol AS underlying, s.kind, s.status,
        s.link_status AS linkStatus, s.opened_on AS openedOn, s.closed_on AS closedOn,
        s.net_premium AS netPremium, s.title
      FROM option_situations s
      JOIN accounts a ON a.id = s.account_id
      ORDER BY s.opened_on DESC, s.id DESC
    `,
    )
    .all() as Array<
    Omit<SituationListRow, "members"> & { accountName: string }
  >;

  const members = db
    .prepare(
      `
      SELECT
        m.situation_id AS situationId,
        m.transaction_id AS transactionId,
        m.role AS role,
        b.trade_date AS tradeDate,
        json_extract(b.raw_json, '$.time') AS tradeTime,
        b.symbol AS symbol,
        b.underlying_symbol AS underlying,
        COALESCE(b.option_expiration, json_extract(b.raw_json, '$.transferItems[0].instrument.expirationDate')) AS expiration,
        b.option_right AS right,
        b.option_strike AS strike,
        b.price AS price,
        b.quantity AS quantity,
        b.position_effect AS positionEffect,
        b.net_amount AS netAmount,
        b.instruction AS instruction,
        b.description AS description,
        CAST(json_extract(b.raw_json, '$.orderId') AS TEXT) AS orderId
      FROM option_situation_members m
      JOIN broker_transactions b ON b.id = m.transaction_id
      ORDER BY b.trade_date ASC, b.id ASC
    `,
    )
    .all() as Array<{
    situationId: string;
    transactionId: string;
    role: SituationMemberRole;
    tradeDate: string;
    tradeTime: string | null;
    symbol: string | null;
    underlying: string | null;
    expiration: string | null;
    right: string | null;
    strike: number | null;
    price: number | null;
    quantity: number | null;
    positionEffect: string | null;
    netAmount: number | null;
    instruction: string | null;
    description: string | null;
    orderId: string | number | null;
  }>;

  const bySit = new Map<string, SituationListRow["members"]>();
  for (const m of members) {
    const list = bySit.get(m.situationId) ?? [];
    const rightRaw = (m.right ?? "").toString().toUpperCase();
    const right = rightRaw.startsWith("C") ? "C" as const : rightRaw.startsWith("P") ? "P" as const : null;
    const orderId =
      m.orderId == null || m.orderId === ""
        ? null
        : String(m.orderId);
    const expiration = typeof m.expiration === "string" ? m.expiration.slice(0, 10) : null;
    const tradeTime = typeof m.tradeTime === "string" ? m.tradeTime : null;
    const deltaAtFill = deltaAtFillFromDb(db, {
      underlying: m.underlying,
      right,
      strike: m.strike,
      expiration,
      price: m.price,
      tradeDate: m.tradeDate,
      tradeTime,
    });
    list.push({
      transactionId: m.transactionId,
      role: m.role,
      tradeDate: m.tradeDate,
      tradeTime,
      symbol: m.symbol,
      underlying: m.underlying,
      expiration,
      right,
      strike: m.strike,
      price: m.price,
      quantity: m.quantity,
      positionEffect: m.positionEffect,
      netAmount: m.netAmount,
      instruction: m.instruction,
      description: m.description,
      orderId,
      deltaAtFill,
    });
    bySit.set(m.situationId, list);
  }

  return sits.map((s) => ({
    ...s,
    linkStatus: s.linkStatus as SituationLinkStatus,
    members: bySit.get(s.id) ?? [],
  }));
}

export function setSituationLinkStatus(
  db: Database.Database,
  situationId: string,
  status: Extract<SituationLinkStatus, "confirmed" | "rejected">,
): boolean {
  const row = db.prepare(`SELECT id FROM option_situations WHERE id = ?`).get(situationId) as { id: string } | undefined;
  if (!row) return false;
  const now = new Date().toISOString();
  db.prepare(`UPDATE option_situations SET link_status = @status, updated_at = @now WHERE id = @id`).run({
    status,
    now,
    id: situationId,
  });
  if (status === "rejected") {
    const members = db
      .prepare(`SELECT transaction_id AS id FROM option_situation_members WHERE situation_id = ?`)
      .all(situationId) as { id: string }[];
    const insert = db.prepare(
      `
      INSERT OR IGNORE INTO option_situation_rejections (id, transaction_id_a, transaction_id_b)
      VALUES (@id, @a, @b)
    `,
    );
    for (let i = 0; i < members.length; i++) {
      for (let j = i + 1; j < members.length; j++) {
        const a = members[i]!.id;
        const b = members[j]!.id;
        const [x, y] = a < b ? [a, b] : [b, a];
        insert.run({ id: newId("srej"), a: x, b: y });
      }
    }
  }
  return true;
}

export function situationsToCsv(rows: SituationListRow[]): string {
  const headers = [
    "id",
    "underlying",
    "kind",
    "status",
    "linkStatus",
    "openedOn",
    "closedOn",
    "netPremium",
    "title",
    "account",
    "memberCount",
    "transactionIds",
  ];
  const lines = [headers.join(",")];
  const esc = (s: string | null | undefined) => `"${(s ?? "").replace(/"/g, '""')}"`;
  for (const r of rows) {
    lines.push(
      [
        esc(r.id),
        esc(r.underlying),
        esc(r.kind),
        esc(r.status),
        esc(r.linkStatus),
        r.openedOn,
        r.closedOn ?? "",
        r.netPremium ?? "",
        esc(r.title),
        esc(r.accountName),
        r.members.length,
        esc(r.members.map((m) => m.transactionId).join("|")),
      ].join(","),
    );
  }
  return lines.join("\n");
}
