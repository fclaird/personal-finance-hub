PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS schema_migrations (
  id INTEGER PRIMARY KEY,
  name TEXT NOT NULL UNIQUE,
  applied_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS schwab_refresh_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  mode TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  ok INTEGER NOT NULL DEFAULT 0,
  steps_json TEXT,
  quotes_symbols INTEGER,
  holdings_as_of TEXT
);

CREATE INDEX IF NOT EXISTS idx_schwab_refresh_runs_finished ON schwab_refresh_runs(finished_at DESC);

-- Institution connections (Schwab, Plaid, file import, etc.)
CREATE TABLE IF NOT EXISTS institution_connections (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- 'schwab' | 'plaid' | 'file'
  display_name TEXT NOT NULL,
  status TEXT NOT NULL, -- 'active' | 'error' | 'disabled'
  last_sync_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS accounts (
  id TEXT PRIMARY KEY,
  connection_id TEXT NOT NULL REFERENCES institution_connections(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  nickname TEXT,
  schwab_account_hash TEXT,
  type TEXT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS securities (
  id TEXT PRIMARY KEY,
  symbol TEXT,
  name TEXT,
  security_type TEXT NOT NULL, -- 'equity' | 'fund' | 'cash' | 'option' | 'other'
  cusip TEXT,
  isin TEXT,
  underlying_security_id TEXT REFERENCES securities(id),
  option_type TEXT,
  expiration_date TEXT,
  strike_price REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS holding_snapshots (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  as_of TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS positions (
  id TEXT PRIMARY KEY,
  snapshot_id TEXT NOT NULL REFERENCES holding_snapshots(id) ON DELETE CASCADE,
  security_id TEXT NOT NULL REFERENCES securities(id),
  quantity REAL NOT NULL,
  price REAL, -- per-unit price, if known
  market_value REAL, -- if known
  metadata_json TEXT, -- connector-specific details
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS option_greeks (
  id TEXT PRIMARY KEY,
  position_id TEXT NOT NULL UNIQUE REFERENCES positions(id) ON DELETE CASCADE,
  delta REAL,
  gamma REAL,
  theta REAL,
  vega REAL,
  iv REAL,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Security taxonomy / fundamentals caching (sector, industry, etc.)
CREATE TABLE IF NOT EXISTS security_taxonomy (
  symbol TEXT PRIMARY KEY,
  sector TEXT,
  industry TEXT,
  market_cap REAL, -- numeric market cap when available
  market_cap_bucket TEXT, -- 'mega' | 'large' | 'mid' | 'small' | 'micro' | 'unknown'
  revenue_geo_bucket TEXT, -- 'US' | 'Intl' | 'Mixed' | 'unknown'
  source TEXT, -- 'schwab' | 'manual' | etc.
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS target_allocations (
  id TEXT PRIMARY KEY,
  scope TEXT NOT NULL, -- 'global' | 'account'
  account_id TEXT REFERENCES accounts(id) ON DELETE CASCADE,
  asset_class TEXT NOT NULL,
  target_weight REAL NOT NULL, -- 0..1
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alert_rules (
  id TEXT PRIMARY KEY,
  type TEXT NOT NULL, -- 'drift' | 'concentration' | 'change'
  config_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alert_events (
  id TEXT PRIMARY KEY,
  rule_id TEXT NOT NULL REFERENCES alert_rules(id) ON DELETE CASCADE,
  occurred_at TEXT NOT NULL,
  severity TEXT NOT NULL, -- 'info' | 'warning' | 'critical'
  title TEXT NOT NULL,
  details_json TEXT,
  acknowledged_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Cached market data (benchmarks, underlying prices, etc.)
CREATE TABLE IF NOT EXISTS price_points (
  provider TEXT NOT NULL, -- 'schwab'
  symbol TEXT NOT NULL,
  date TEXT NOT NULL, -- ISO date (YYYY-MM-DD)
  close REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, symbol, date)
);

-- Account equity/value time series (best-available).
-- For Schwab this is populated from point-in-time account balances on each sync.
CREATE TABLE IF NOT EXISTS account_value_points (
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  as_of TEXT NOT NULL, -- ISO datetime
  equity_value REAL NOT NULL, -- account equity / liquidation value proxy
  cash_value REAL, -- if available
  source TEXT NOT NULL, -- 'schwab_balances' | 'manual' | etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (account_id, as_of)
);

-- Weekly (or thinned monthly for old periods) portfolio totals + SPY/QQQ closes on the same calendar date.
-- Buckets match Performance UI: combined | retirement | brokerage. Depth is limited by sync history (no broker NAV time machine).
CREATE TABLE IF NOT EXISTS portfolio_snapshots (
  id TEXT PRIMARY KEY,
  snapshot_date TEXT NOT NULL, -- ISO YYYY-MM-DD (typically week-ending Friday)
  bucket TEXT NOT NULL DEFAULT 'combined', -- 'combined' | 'retirement' | 'brokerage'
  total_value REAL NOT NULL,
  account_balances_json TEXT, -- optional JSON map of account_id -> value for debugging
  spy_close REAL,
  qqq_close REAL,
  source TEXT NOT NULL, -- 'backfill_holdings' | 'weekly_job' | 'cron_weekly' | etc.
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(snapshot_date, bucket)
);

CREATE INDEX IF NOT EXISTS idx_portfolio_snapshots_date ON portfolio_snapshots(snapshot_date);

-- Cached OHLCV candles for terminal visualizations + volume anomaly detection.
-- interval: '1d' | '5m' etc. ts_ms: candle start time in epoch ms.
CREATE TABLE IF NOT EXISTS ohlcv_points (
  provider TEXT NOT NULL, -- 'schwab'
  symbol TEXT NOT NULL,
  interval TEXT NOT NULL,
  ts_ms INTEGER NOT NULL,
  open REAL,
  high REAL,
  low REAL,
  close REAL,
  volume REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (provider, symbol, interval, ts_ms)
);

CREATE INDEX IF NOT EXISTS idx_ohlcv_points_symbol_interval_ts ON ohlcv_points(symbol, interval, ts_ms);

-- Cashflows (dividends, interest, etc.)
CREATE TABLE IF NOT EXISTS cashflows (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  security_id TEXT REFERENCES securities(id),
  type TEXT NOT NULL, -- 'dividend_actual' | 'dividend_projected'
  amount REAL NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  ex_date TEXT,
  pay_date TEXT NOT NULL, -- ISO date or datetime
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- Upcoming / recent earnings + trade-opportunity metrics (IV vs “normal”, dollar liquidity).
-- IV fields are intended for Schwab (or other broker) enrichment; calendar often comes from Finnhub.
CREATE TABLE IF NOT EXISTS earnings_events (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL COLLATE NOCASE,
  security_id TEXT REFERENCES securities(id) ON DELETE SET NULL,
  earnings_date TEXT NOT NULL, -- YYYY-MM-DD
  fiscal_period_end TEXT,
  time_of_day TEXT, -- 'bmo' | 'amc' | 'dmh' | ''
  source TEXT NOT NULL, -- 'finnhub' | 'demo' | 'schwab' | 'manual'
  raw_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(symbol, earnings_date)
);

CREATE INDEX IF NOT EXISTS idx_earnings_events_date ON earnings_events(earnings_date);
CREATE INDEX IF NOT EXISTS idx_earnings_events_symbol ON earnings_events(symbol);

-- Dividend model portfolios: local materialized history + optional forward weekly log (see /dividend-models).
CREATE TABLE IF NOT EXISTS dividend_model_portfolios (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  live_started_at TEXT,
  tracking_mode TEXT NOT NULL DEFAULT 'backtest',
  meta_json TEXT
);

CREATE TABLE IF NOT EXISTS dividend_model_holdings (
  id TEXT PRIMARY KEY,
  portfolio_id TEXT NOT NULL REFERENCES dividend_model_portfolios(id) ON DELETE CASCADE,
  symbol TEXT NOT NULL COLLATE NOCASE,
  sort_order INTEGER NOT NULL DEFAULT 0,
  shares REAL,
  avg_unit_cost REAL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(portfolio_id, symbol)
);

CREATE INDEX IF NOT EXISTS idx_dividend_model_holdings_portfolio ON dividend_model_holdings(portfolio_id, sort_order);

CREATE TABLE IF NOT EXISTS dividend_model_symbol_fundamentals_snap (
  id TEXT PRIMARY KEY,
  symbol TEXT NOT NULL COLLATE NOCASE,
  captured_at TEXT NOT NULL,
  display_name TEXT,
  div_yield REAL,
  annual_div_est REAL,
  next_ex_date TEXT,
  raw_json TEXT,
  source TEXT NOT NULL DEFAULT 'schwab_fundamental'
);

CREATE INDEX IF NOT EXISTS idx_dividend_model_fundamentals_symbol_time ON dividend_model_symbol_fundamentals_snap(symbol, captured_at DESC);

-- Mode A chart: modeled month-end aggregates (5y rear-facing; current month may be partial).
CREATE TABLE IF NOT EXISTS dividend_model_portfolio_monthly (
  portfolio_id TEXT NOT NULL REFERENCES dividend_model_portfolios(id) ON DELETE CASCADE,
  month_end TEXT NOT NULL,
  total_market_value REAL,
  total_dividends REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  is_backfilled INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (portfolio_id, month_end)
);

CREATE INDEX IF NOT EXISTS idx_dividend_model_monthly_portfolio_end ON dividend_model_portfolio_monthly(portfolio_id, month_end);

CREATE TABLE IF NOT EXISTS dividend_model_portfolio_monthly_symbol (
  portfolio_id TEXT NOT NULL,
  symbol TEXT NOT NULL COLLATE NOCASE,
  month_end TEXT NOT NULL,
  month_dividends REAL NOT NULL DEFAULT 0,
  market_value_eom REAL,
  close_eom REAL,
  shares_used REAL,
  annualized_yield_pct REAL,
  PRIMARY KEY (portfolio_id, symbol, month_end),
  FOREIGN KEY (portfolio_id) REFERENCES dividend_model_portfolios(id) ON DELETE CASCADE
);

-- Symbol-level monthly facts (5y); shared across simulated portfolios.
CREATE TABLE IF NOT EXISTS symbol_monthly_market (
  symbol TEXT NOT NULL COLLATE NOCASE,
  month_end TEXT NOT NULL,
  close_eom REAL,
  dividend_per_share REAL NOT NULL DEFAULT 0,
  annualized_yield_pct REAL,
  price_source TEXT NOT NULL,
  dividend_source TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (symbol, month_end)
);

CREATE INDEX IF NOT EXISTS idx_symbol_monthly_market_symbol_end ON symbol_monthly_market(symbol, month_end);

-- Raw dividend payment events (5y Yahoo backfill; shared across portfolios).
CREATE TABLE IF NOT EXISTS symbol_dividend_payments (
  symbol TEXT NOT NULL COLLATE NOCASE,
  pay_date TEXT NOT NULL,
  amount REAL NOT NULL,
  source TEXT NOT NULL DEFAULT 'yahoo_chart_div',
  captured_at TEXT NOT NULL,
  PRIMARY KEY (symbol, pay_date, amount)
);

CREATE INDEX IF NOT EXISTS idx_symbol_dividend_payments_symbol_date ON symbol_dividend_payments(symbol, pay_date);

-- Explicit backtest window start prices (market close at window anchor; not purchase price).
CREATE TABLE IF NOT EXISTS symbol_backtest_anchor (
  symbol TEXT NOT NULL COLLATE NOCASE,
  window_years INTEGER NOT NULL,
  anchor_month_end TEXT NOT NULL,
  close_eom REAL,
  price_source TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (symbol, window_years)
);

CREATE INDEX IF NOT EXISTS idx_symbol_backtest_anchor_symbol ON symbol_backtest_anchor(symbol);

-- Backtest-only synthetic share counts (target NAV at window start; does not modify dividend_model_holdings).
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

-- Hypothetical portfolio path: reinvest vs withdraw (manual shares + symbol_monthly_market).
CREATE TABLE IF NOT EXISTS dividend_model_portfolio_sim_monthly (
  portfolio_id TEXT NOT NULL REFERENCES dividend_model_portfolios(id) ON DELETE CASCADE,
  month_end TEXT NOT NULL,
  simulation_mode TEXT NOT NULL,
  nav_total REAL,
  total_dividends REAL NOT NULL DEFAULT 0,
  portfolio_rebased_pct REAL,
  price_only_rebased_pct REAL,
  status TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  PRIMARY KEY (portfolio_id, month_end, simulation_mode)
);

CREATE INDEX IF NOT EXISTS idx_dividend_model_sim_monthly ON dividend_model_portfolio_sim_monthly(portfolio_id, simulation_mode, month_end);

-- DRIP ledger: one row per dividend payment, with the pay-date price and resulting share count.
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

-- Mode B chart: forward-only weekly (Friday week key) snapshots; no historical forward rows before live_started_at.
CREATE TABLE IF NOT EXISTS dividend_model_portfolio_forward_snap (
  portfolio_id TEXT NOT NULL REFERENCES dividend_model_portfolios(id) ON DELETE CASCADE,
  as_of TEXT NOT NULL,
  nav_total REAL,
  dividends_period REAL NOT NULL DEFAULT 0,
  status TEXT NOT NULL,
  computed_at TEXT NOT NULL,
  spy_rebased_pct REAL,
  qqq_rebased_pct REAL,
  PRIMARY KEY (portfolio_id, as_of)
);

CREATE INDEX IF NOT EXISTS idx_dividend_model_forward_portfolio_asof ON dividend_model_portfolio_forward_snap(portfolio_id, as_of);

-- Live forward tracking for Schwab-aggregated Dividends tab (all accounts, dividend book).
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

-- Terminal X digest cache (server-side; populated by cron or manual refresh).
CREATE TABLE IF NOT EXISTS x_digest_cache (
  id TEXT PRIMARY KEY,
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS x_symbol_cache (
  symbol TEXT PRIMARY KEY COLLATE NOCASE,
  generated_at TEXT NOT NULL,
  payload_json TEXT NOT NULL
);

-- Schwab (and future brokers) transaction history for strategy views.
-- One row per API activity; `raw_json` holds full payload including all legs.
CREATE TABLE IF NOT EXISTS broker_transactions (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
  external_activity_id TEXT NOT NULL,
  trade_date TEXT NOT NULL,
  transaction_type TEXT,
  description TEXT,
  net_amount REAL,
  raw_json TEXT NOT NULL,
  symbol TEXT,
  underlying_symbol TEXT,
  asset_type TEXT,
  instruction TEXT,
  position_effect TEXT,
  quantity REAL,
  price REAL,
  option_expiration TEXT,
  option_right TEXT,
  option_strike REAL,
  leg_count INTEGER NOT NULL DEFAULT 1,
  strategy_category TEXT,
  classified_at TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE(account_id, external_activity_id)
);

CREATE INDEX IF NOT EXISTS idx_broker_tx_account_date ON broker_transactions(account_id, trade_date);
CREATE INDEX IF NOT EXISTS idx_broker_tx_category ON broker_transactions(strategy_category, trade_date);

-- Daily allocation snapshot per underlying (NY calendar trade_date). Filled by cron / post-sync.
CREATE TABLE IF NOT EXISTS allocation_daily_underlying (
  trade_date TEXT NOT NULL,
  data_mode TEXT NOT NULL,
  scope TEXT NOT NULL,
  symbol TEXT NOT NULL,
  spot_market_value REAL NOT NULL,
  synthetic_market_value REAL NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  PRIMARY KEY (trade_date, data_mode, scope, symbol)
);

CREATE INDEX IF NOT EXISTS idx_alloc_daily_lookup ON allocation_daily_underlying(data_mode, scope, trade_date);

CREATE TABLE IF NOT EXISTS earnings_opp_metrics (
  id TEXT PRIMARY KEY,
  earnings_event_id TEXT NOT NULL UNIQUE REFERENCES earnings_events(id) ON DELETE CASCADE,
  as_of TEXT NOT NULL,
  iv_current REAL,
  iv_52w_high REAL,
  iv_52w_low REAL,
  iv_rank_pct REAL,
  hist_vol_30d REAL,
  avg_share_volume_20d REAL,
  avg_share_volume_5d REAL,
  volume_ratio REAL,
  session_volume REAL,
  iv_over_hist_vol REAL,
  relative_volume_index REAL,
  avg_dollar_volume_20d REAL,
  dollar_liquidity_score REAL,
  opportunity_score REAL,
  metrics_source TEXT,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);

-- User-authored notes per ticker (Terminal symbol page).
CREATE TABLE IF NOT EXISTS symbol_notes (
  symbol TEXT PRIMARY KEY COLLATE NOCASE,
  body TEXT NOT NULL DEFAULT '',
  updated_at TEXT NOT NULL
);

-- Cached issuer narrative: business_summary = open sources; sec_filing_summary = EDGAR excerpt.
CREATE TABLE IF NOT EXISTS symbol_issuer_narrative (
  symbol TEXT PRIMARY KEY COLLATE NOCASE,
  business_summary TEXT NOT NULL,
  sources_json TEXT NOT NULL,
  content_source TEXT NOT NULL,
  yahoo_profile_url TEXT,
  sec_filing_summary TEXT,
  sec_cik TEXT,
  sec_form TEXT,
  sec_filing_date TEXT,
  sec_accession TEXT,
  sec_document_url TEXT,
  fetched_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Curated “what they do” copy (wins over automated sources when set).
CREATE TABLE IF NOT EXISTS symbol_narrative_override (
  symbol TEXT PRIMARY KEY COLLATE NOCASE,
  summary TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Curated “what they do” copy (wins over automated sources when set).
CREATE TABLE IF NOT EXISTS symbol_narrative_override (
  symbol TEXT PRIMARY KEY COLLATE NOCASE,
  summary TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

