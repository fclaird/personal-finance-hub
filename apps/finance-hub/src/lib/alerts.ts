import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";

export type AlertRuleType = "drift" | "concentration";

export type DriftRuleConfig = { thresholdPct: number }; // e.g. 0.05 = 5%
export type ConcentrationRuleConfig = { maxSingleUnderlyingPct: number }; // e.g. 0.25 = 25%

export type AlertRule = {
  id: string;
  type: AlertRuleType;
  enabled: boolean;
  config: unknown;
};

export function getAlertRules(): AlertRule[] {
  const db = getDb();
  const rows = db.prepare(`SELECT id, type, enabled, config_json FROM alert_rules ORDER BY type ASC`).all() as Array<{
    id: string;
    type: AlertRuleType;
    enabled: number;
    config_json: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    type: r.type,
    enabled: !!r.enabled,
    config: JSON.parse(r.config_json),
  }));
}

export function upsertAlertRule(type: AlertRuleType, enabled: boolean, config: unknown) {
  const db = getDb();
  const id = `rule_${type}`;
  db.prepare(
    `
    INSERT INTO alert_rules (id, type, config_json, enabled, updated_at)
    VALUES (?, ?, ?, ?, datetime('now'))
    ON CONFLICT(id) DO UPDATE SET
      config_json = excluded.config_json,
      enabled = excluded.enabled,
      updated_at = excluded.updated_at
  `,
  ).run(id, type, JSON.stringify(config), enabled ? 1 : 0);
}

export function insertAlertEvent(params: {
  ruleId: string;
  severity: "info" | "warning" | "critical";
  title: string;
  details?: unknown;
}) {
  const db = getDb();
  db.prepare(
    `
    INSERT INTO alert_events (id, rule_id, occurred_at, severity, title, details_json)
    VALUES (?, ?, datetime('now'), ?, ?, ?)
  `,
  ).run(newId("alert"), params.ruleId, params.severity, params.title, params.details ? JSON.stringify(params.details) : null);
}

export function getAlertEvents(limit = 50) {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT ae.id, ae.occurred_at, ae.severity, ae.title, ae.details_json, ar.type as rule_type
      FROM alert_events ae
      JOIN alert_rules ar ON ar.id = ae.rule_id
      ORDER BY ae.occurred_at DESC
      LIMIT ?
    `,
    )
    .all(limit) as Array<{
    id: string;
    occurred_at: string;
    severity: string;
    title: string;
    details_json: string | null;
    rule_type: string;
  }>;
}

