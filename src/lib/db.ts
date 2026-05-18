import fs from "node:fs";

import Database from "better-sqlite3";

import { ensureDirSync } from "@/lib/fs";
import { getAppDataDir, getDbPath } from "@/lib/paths";

let _db: Database.Database | null = null;

function readSchemaSql(): string {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const path = require("node:path") as typeof import("node:path");
  const schemaPath = path.join(process.cwd(), "src", "db", "schema.sql");
  return fs.readFileSync(schemaPath, "utf-8");
}

export function getDb(): Database.Database {
  if (_db) return _db;
  ensureDirSync(getAppDataDir());
  const dbPath = getDbPath();
  _db = new Database(dbPath);
  _db.pragma("foreign_keys = ON");
  migrate(_db);
  return _db;
}

function columnNames(db: Database.Database, table: string): Set<string> {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as Array<{ name: string }>;
  return new Set(rows.map((r) => r.name));
}

function ensureColumn(db: Database.Database, table: string, name: string, ddl: string) {
  if (columnNames(db, table).has(name)) return;
  db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
}

function migrate(db: Database.Database) {
  const schema = readSchemaSql();
  db.exec(schema);
  // Lightweight ALTERs for existing SQLite files created before new columns.
  const hasAccounts = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts' LIMIT 1`)
    .get();
  if (hasAccounts) {
    ensureColumn(db, "accounts", "nickname", "nickname TEXT");
    ensureColumn(db, "accounts", "schwab_account_hash", "schwab_account_hash TEXT");
  }
  const hasSecurities = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='securities' LIMIT 1`)
    .get();
  if (hasSecurities) {
    ensureColumn(db, "securities", "option_type", "option_type TEXT");
    ensureColumn(db, "securities", "expiration_date", "expiration_date TEXT");
    ensureColumn(db, "securities", "strike_price", "strike_price REAL");
  }
  const hasTaxonomy = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='security_taxonomy' LIMIT 1`)
    .get();
  if (hasTaxonomy) {
    ensureColumn(db, "security_taxonomy", "market_cap", "market_cap REAL");
  }
  const hasEarningsMetrics = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='earnings_opp_metrics' LIMIT 1`)
    .get();
  if (hasEarningsMetrics) {
    ensureColumn(db, "earnings_opp_metrics", "session_volume", "session_volume REAL");
    ensureColumn(db, "earnings_opp_metrics", "iv_over_hist_vol", "iv_over_hist_vol REAL");
    ensureColumn(db, "earnings_opp_metrics", "relative_volume_index", "relative_volume_index REAL");
    ensureColumn(db, "earnings_opp_metrics", "avg_dollar_volume_20d", "avg_dollar_volume_20d REAL");
    ensureColumn(db, "earnings_opp_metrics", "dollar_liquidity_score", "dollar_liquidity_score REAL");
  }
  const hasDmHoldings = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='dividend_model_holdings' LIMIT 1`)
    .get();
  if (hasDmHoldings) {
    ensureColumn(db, "dividend_model_holdings", "avg_unit_cost", "avg_unit_cost REAL");
  }
  const hasDmFundSnap = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='dividend_model_symbol_fundamentals_snap' LIMIT 1`)
    .get();
  if (hasDmFundSnap) {
    ensureColumn(db, "dividend_model_symbol_fundamentals_snap", "next_ex_date", "next_ex_date TEXT");
  }
  const hasDmMonthlySym = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='dividend_model_portfolio_monthly_symbol' LIMIT 1`)
    .get();
  if (hasDmMonthlySym) {
    ensureColumn(db, "dividend_model_portfolio_monthly_symbol", "annualized_yield_pct", "annualized_yield_pct REAL");
  }
  const hasDmSimMonthly = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='dividend_model_portfolio_sim_monthly' LIMIT 1`)
    .get();
  if (hasDmSimMonthly) {
    ensureColumn(db, "dividend_model_portfolio_sim_monthly", "price_only_rebased_pct", "price_only_rebased_pct REAL");
  }
  // In Phase 1 we keep migrations as a single schema file; we can add proper migration files later.
  const name = "0001_init";
  const exists = db
    .prepare("SELECT 1 FROM schema_migrations WHERE name = ? LIMIT 1")
    .get(name);
  if (!exists) {
    db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(name);
  }
}

