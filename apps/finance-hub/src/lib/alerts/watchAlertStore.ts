import type Database from "better-sqlite3";

import { emitAlertNotice } from "@/lib/alerts/notify";
import {
  evaluateWatchAlerts,
  type IvSpikeConfig,
  type PriceAlertConfig,
  type ProfitTargetConfig,
  type SymbolPnl,
  type WatchAlert,
  type WatchAlertKind,
  type WatchFiring,
  type WatchQuote,
} from "@/lib/alerts/watchAlerts";
import { newId } from "@/lib/id";

const WATCH_RULE_ID = "rule_watch";

export function ensureWatchTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS watchlists (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
    CREATE TABLE IF NOT EXISTS watchlist_items (
      watchlist_id TEXT NOT NULL REFERENCES watchlists(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL COLLATE NOCASE,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      PRIMARY KEY (watchlist_id, symbol)
    );
    CREATE TABLE IF NOT EXISTS watch_alerts (
      id TEXT PRIMARY KEY,
      kind TEXT NOT NULL,
      symbol TEXT NOT NULL COLLATE NOCASE,
      config_json TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    );
  `);
  const columns = db.prepare(`PRAGMA table_info(watchlist_items)`).all() as Array<{ name: string }>;
  if (!columns.some((column) => column.name === "created_at")) {
    db.exec(`ALTER TABLE watchlist_items ADD COLUMN created_at TEXT NOT NULL DEFAULT (datetime('now'))`);
  }
}

function isKind(value: string): value is WatchAlertKind {
  return value === "price" || value === "iv-spike" || value === "profit-target";
}

function parseConfig(kind: WatchAlertKind, raw: unknown): WatchAlert["config"] | null {
  if (raw == null || typeof raw !== "object") return null;
  const record = raw as Record<string, unknown>;
  if (kind === "price") {
    const direction = record.direction === "above" || record.direction === "below" ? record.direction : null;
    const level = typeof record.level === "number" && Number.isFinite(record.level) ? record.level : null;
    if (!direction || level == null || !(level > 0)) return null;
    return { direction, level };
  }
  if (kind === "iv-spike") {
    const minRankPct = typeof record.minRankPct === "number" && Number.isFinite(record.minRankPct) ? record.minRankPct : null;
    if (minRankPct == null || minRankPct < 0 || minRankPct > 100) return null;
    return { minRankPct };
  }
  const targetPnl = typeof record.targetPnl === "number" && Number.isFinite(record.targetPnl) ? record.targetPnl : null;
  if (targetPnl == null) return null;
  return { targetPnl };
}

export function listWatchAlerts(db: Database.Database): WatchAlert[] {
  ensureWatchTables(db);
  const rows = db
    .prepare(`SELECT id, kind, symbol, config_json, enabled FROM watch_alerts ORDER BY symbol ASC, created_at ASC`)
    .all() as Array<{ id: string; kind: string; symbol: string; config_json: string; enabled: number }>;
  const out: WatchAlert[] = [];
  for (const row of rows) {
    if (!isKind(row.kind)) continue;
    let parsed: unknown;
    try {
      parsed = JSON.parse(row.config_json);
    } catch {
      continue;
    }
    const config = parseConfig(row.kind, parsed);
    if (!config) continue;
    out.push({ id: row.id, kind: row.kind, symbol: row.symbol.toUpperCase(), enabled: row.enabled === 1, config });
  }
  return out;
}

export function insertWatchAlert(
  db: Database.Database,
  input: { kind: WatchAlertKind; symbol: string; config: PriceAlertConfig | IvSpikeConfig | ProfitTargetConfig },
): WatchAlert | null {
  ensureWatchTables(db);
  const symbol = input.symbol.trim().toUpperCase();
  const config = parseConfig(input.kind, input.config);
  if (!symbol || !config) return null;
  const id = newId("walert");
  db.prepare(`INSERT INTO watch_alerts (id, kind, symbol, config_json, enabled) VALUES (?, ?, ?, ?, 1)`).run(
    id,
    input.kind,
    symbol,
    JSON.stringify(config),
  );
  return { id, kind: input.kind, symbol, enabled: true, config };
}

export function deleteWatchAlert(db: Database.Database, id: string): boolean {
  ensureWatchTables(db);
  const result = db.prepare(`DELETE FROM watch_alerts WHERE id = ?`).run(id);
  return result.changes > 0;
}

export function setWatchAlertEnabled(db: Database.Database, id: string, enabled: boolean): boolean {
  ensureWatchTables(db);
  const result = db.prepare(`UPDATE watch_alerts SET enabled = ?, updated_at = datetime('now') WHERE id = ?`).run(enabled ? 1 : 0, id);
  return result.changes > 0;
}

function ensureWatchRule(db: Database.Database): void {
  db.prepare(
    `
    INSERT INTO alert_rules (id, type, config_json, enabled)
    VALUES (?, 'watch', '{}', 1)
    ON CONFLICT(id) DO NOTHING
  `,
  ).run(WATCH_RULE_ID);
}

function alreadyFiredToday(db: Database.Database, title: string): boolean {
  const row = db
    .prepare(
      `
      SELECT 1 AS hit
      FROM alert_events
      WHERE rule_id = ? AND title = ? AND substr(occurred_at, 1, 10) = date('now')
      LIMIT 1
    `,
    )
    .get(WATCH_RULE_ID, title) as { hit: number } | undefined;
  return row != null;
}

/** Evaluate enabled alerts and store new in-app events. The notice hook runs for each new row. */
export function runWatchAlerts(
  db: Database.Database,
  quotes: readonly WatchQuote[],
  pnls: readonly SymbolPnl[],
): { created: number; firings: WatchFiring[] } {
  ensureWatchTables(db);
  ensureWatchRule(db);
  const firings = evaluateWatchAlerts(listWatchAlerts(db), quotes, pnls);
  let created = 0;
  const insert = db.prepare(
    `
    INSERT INTO alert_events (id, rule_id, occurred_at, severity, title, details_json)
    VALUES (?, ?, datetime('now'), ?, ?, ?)
  `,
  );
  for (const firing of firings) {
    if (alreadyFiredToday(db, firing.title)) continue;
    insert.run(newId("alert"), WATCH_RULE_ID, firing.severity, firing.title, JSON.stringify(firing.details));
    emitAlertNotice({ title: firing.title, severity: firing.severity, body: firing.symbol });
    created += 1;
  }
  return { created, firings };
}
