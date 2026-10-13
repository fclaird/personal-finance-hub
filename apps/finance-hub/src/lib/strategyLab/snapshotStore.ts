import type { Database } from "better-sqlite3";

import { parseScenario } from "@/lib/strategyLab/scenarioStore";
import {
  cleanSnapshotSummary,
  defaultSnapshotSummary,
  parseSnapshotProvenance,
  parseSnapshotQuotes,
  type SnapshotProvenance,
  type SnapshotQuotes,
} from "@/lib/strategyLab/snapshots";
import type { LabScenario } from "@/lib/strategyLab/lab";

export type SnapshotListItem = {
  readonly id: string;
  readonly createdAt: string;
  readonly symbol: string;
  readonly summary: string;
  readonly provenance: SnapshotProvenance;
};

export type SnapshotRecord = SnapshotListItem & {
  readonly scenario: LabScenario;
  readonly quotes: SnapshotQuotes;
};

const ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw != null && typeof raw === "object" && !Array.isArray(raw);
}

type SnapshotSqlRow = {
  id: string;
  created_at: string;
  symbol: string;
  scenario_json: string;
  quotes_json: string;
  provenance_json: string;
  summary: string;
};

function readJson(text: string): unknown {
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

function toRecord(row: SnapshotSqlRow): SnapshotRecord | null {
  const scenario = parseScenario(readJson(row.scenario_json));
  const quotes = parseSnapshotQuotes(readJson(row.quotes_json));
  const provenance = parseSnapshotProvenance(readJson(row.provenance_json));
  const summary = cleanSnapshotSummary(row.summary);
  if (!scenario || !quotes || !provenance || !summary || scenario.symbol !== row.symbol) return null;
  return {
    id: row.id,
    createdAt: row.created_at,
    symbol: row.symbol,
    summary,
    provenance,
    scenario,
    quotes,
  };
}

export function listSnapshots(db: Database, symbol: string): SnapshotListItem[] {
  const clean = symbol.trim().toUpperCase();
  if (!clean) return [];
  const rows = db
    .prepare(
      `SELECT id, created_at, symbol, scenario_json, quotes_json, provenance_json, summary
       FROM strategy_lab_snapshots
       WHERE symbol = ?
       ORDER BY created_at DESC, id ASC`,
    )
    .all(clean) as SnapshotSqlRow[];
  return rows.flatMap((row) => {
    const record = toRecord(row);
    if (!record) return [];
    return [{ id: record.id, createdAt: record.createdAt, symbol: record.symbol, summary: record.summary, provenance: record.provenance }];
  });
}

export function getSnapshot(db: Database, id: string): SnapshotRecord | null {
  if (!ID_RE.test(id)) return null;
  const row = db
    .prepare(
      `SELECT id, created_at, symbol, scenario_json, quotes_json, provenance_json, summary
       FROM strategy_lab_snapshots WHERE id = ?`,
    )
    .get(id) as SnapshotSqlRow | undefined;
  return row ? toRecord(row) : null;
}

/** Persist a scenario only after the same parser localStorage uses. Returns the stable id. */
export function saveSnapshot(db: Database, raw: unknown, now = new Date().toISOString()): { ok: true; row: SnapshotRecord } | { ok: false; error: string } {
  if (!isRecord(raw)) return { ok: false, error: "Snapshot body must be an object." };
  const scenario = parseScenario(raw.scenario);
  if (!scenario) return { ok: false, error: "Scenario did not validate." };
  const quotes = parseSnapshotQuotes(raw.quotes);
  if (!quotes) return { ok: false, error: "Quotes did not validate." };
  const provenance = parseSnapshotProvenance(raw.provenance);
  if (!provenance) return { ok: false, error: "Provenance did not validate." };
  const summary = (typeof raw.summary === "string" && raw.summary.trim() ? cleanSnapshotSummary(raw.summary) : null) ?? cleanSnapshotSummary(defaultSnapshotSummary(scenario));
  if (!summary) return { ok: false, error: "Summary must be 1 to 160 characters." };
  if (now.length < 1 || now.length > 40) return { ok: false, error: "Timestamp is not usable." };
  const id = crypto.randomUUID();
  const row: SnapshotRecord = { id, createdAt: now, symbol: scenario.symbol, summary, provenance, scenario, quotes };
  db.prepare(
    `INSERT INTO strategy_lab_snapshots (id, created_at, symbol, scenario_json, quotes_json, provenance_json, summary)
     VALUES (@id, @created_at, @symbol, @scenario_json, @quotes_json, @provenance_json, @summary)`,
  ).run({
    id,
    created_at: now,
    symbol: scenario.symbol,
    scenario_json: JSON.stringify(scenario),
    quotes_json: JSON.stringify(quotes),
    provenance_json: JSON.stringify(provenance),
    summary,
  });
  return { ok: true, row };
}

export function deleteSnapshot(db: Database, id: string): { ok: true; id: string } | { ok: false; error: string } {
  if (!ID_RE.test(id)) return { ok: false, error: "Snapshot not found." };
  const result = db.prepare(`DELETE FROM strategy_lab_snapshots WHERE id = ?`).run(id);
  if (result.changes !== 1) return { ok: false, error: "Snapshot not found." };
  return { ok: true, id };
}
