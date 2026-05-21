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
    ensureColumn(db, "dividend_model_symbol_fundamentals_snap", "display_name", "display_name TEXT");
  }
  const hasDmPortfolios = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='dividend_model_portfolios' LIMIT 1`)
    .get();
  if (hasDmPortfolios) {
    ensureColumn(db, "dividend_model_portfolios", "tracking_mode", "tracking_mode TEXT NOT NULL DEFAULT 'backtest'");
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
  db.exec(`
    CREATE TABLE IF NOT EXISTS symbol_notes (
      symbol TEXT PRIMARY KEY COLLATE NOCASE,
      body TEXT NOT NULL DEFAULT '',
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS symbol_issuer_narrative (
      symbol TEXT PRIMARY KEY COLLATE NOCASE,
      business_summary TEXT NOT NULL,
      sources_json TEXT NOT NULL,
      content_source TEXT NOT NULL,
      yahoo_profile_url TEXT,
      sec_cik TEXT,
      sec_form TEXT,
      sec_filing_date TEXT,
      sec_accession TEXT,
      sec_document_url TEXT,
      fetched_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  const hasNarrative = db
    .prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='symbol_issuer_narrative' LIMIT 1`)
    .get();
  if (hasNarrative) {
    ensureColumn(db, "symbol_issuer_narrative", "yahoo_profile_url", "yahoo_profile_url TEXT");
    ensureColumn(db, "symbol_issuer_narrative", "sec_filing_summary", "sec_filing_summary TEXT");
  }
  db.exec(`
    CREATE TABLE IF NOT EXISTS symbol_narrative_override (
      symbol TEXT PRIMARY KEY COLLATE NOCASE,
      summary TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dividend_model_synthetic_holdings (
      portfolio_id TEXT NOT NULL REFERENCES dividend_model_portfolios(id) ON DELETE CASCADE,
      window_years INTEGER NOT NULL,
      symbol TEXT NOT NULL COLLATE NOCASE,
      synthetic_shares REAL NOT NULL,
      anchor_month_end TEXT NOT NULL,
      target_nav_usd REAL NOT NULL,
      weight_pct REAL NOT NULL,
      computed_at TEXT NOT NULL,
      PRIMARY KEY (portfolio_id, window_years, symbol)
    );
    CREATE INDEX IF NOT EXISTS idx_dividend_model_synthetic_holdings_portfolio
      ON dividend_model_synthetic_holdings(portfolio_id, window_years);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dividend_model_drip_ledger (
      portfolio_id TEXT NOT NULL REFERENCES dividend_model_portfolios(id) ON DELETE CASCADE,
      symbol TEXT NOT NULL COLLATE NOCASE,
      pay_date TEXT NOT NULL,
      amount_per_share REAL NOT NULL,
      dividend_cash REAL NOT NULL,
      reinvest_price REAL NOT NULL,
      shares_added REAL NOT NULL,
      shares_after REAL NOT NULL,
      computed_at TEXT NOT NULL,
      PRIMARY KEY (portfolio_id, symbol, pay_date, amount_per_share)
    );
    CREATE INDEX IF NOT EXISTS idx_dividend_model_drip_ledger_portfolio ON dividend_model_drip_ledger(portfolio_id, pay_date);
  `);
  db.exec(`
    CREATE TABLE IF NOT EXISTS dividend_book_meta (
      id TEXT PRIMARY KEY DEFAULT 'default',
      live_started_at TEXT,
      updated_at TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS dividend_book_forward_snap (
      as_of TEXT PRIMARY KEY,
      nav_total REAL,
      dividends_period REAL NOT NULL DEFAULT 0,
      status TEXT NOT NULL,
      computed_at TEXT NOT NULL
    );
  `);
  // In Phase 1 we keep migrations as a single schema file; we can add proper migration files later.
  const name = "0001_init";
  const exists = db
    .prepare("SELECT 1 FROM schema_migrations WHERE name = ? LIMIT 1")
    .get(name);
  if (!exists) {
    db.prepare("INSERT INTO schema_migrations (name) VALUES (?)").run(name);
  }
}

