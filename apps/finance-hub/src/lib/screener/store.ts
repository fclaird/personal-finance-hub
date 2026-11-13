import type Database from "better-sqlite3";

import type { ObservationInput, ScreenerFilters, StoredObservation } from "@/lib/screener/types";

export function ensureScreenerSchema(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS screener_security (
      ticker TEXT PRIMARY KEY COLLATE NOCASE,
      name TEXT,
      in_sp500 INTEGER NOT NULL DEFAULT 0,
      origin TEXT NOT NULL,
      cik INTEGER,
      wiki_symbol TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS screener_observation (
      ticker TEXT NOT NULL COLLATE NOCASE,
      field TEXT NOT NULL,
      source TEXT NOT NULL,
      value_num REAL,
      value_text TEXT,
      as_of TEXT,
      fetched_at TEXT NOT NULL,
      source_url TEXT,
      meta_json TEXT,
      PRIMARY KEY (ticker, field, source)
    );

    CREATE INDEX IF NOT EXISTS idx_screener_observation_ticker ON screener_observation(ticker);

    CREATE TABLE IF NOT EXISTS screener_war_edit (
      ticker TEXT PRIMARY KEY COLLATE NOCASE,
      rating TEXT,
      source_url TEXT,
      unverified INTEGER NOT NULL,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS screener_preset (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      filters_json TEXT NOT NULL,
      built_in INTEGER NOT NULL DEFAULT 0,
      updated_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS screener_adj_close (
      source TEXT NOT NULL,
      symbol TEXT NOT NULL,
      date TEXT NOT NULL,
      adj_close REAL NOT NULL,
      fetched_at TEXT NOT NULL,
      PRIMARY KEY (source, symbol, date)
    );

    CREATE TABLE IF NOT EXISTS screener_http_cache (
      cache_key TEXT PRIMARY KEY,
      body TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS screener_quota (
      source TEXT NOT NULL,
      day TEXT NOT NULL,
      count INTEGER NOT NULL,
      PRIMARY KEY (source, day)
    );
  `);
}

export type SecurityRow = {
  ticker: string;
  name: string | null;
  inSp500: boolean;
  origin: string;
  cik: number | null;
  wikiSymbol: string | null;
};

export function listSecurities(db: Database.Database): SecurityRow[] {
  const rows = db
    .prepare(
      `SELECT ticker, name, in_sp500 AS inSp500, origin, cik, wiki_symbol AS wikiSymbol FROM screener_security ORDER BY ticker`,
    )
    .all() as Array<{
    ticker: string;
    name: string | null;
    inSp500: number;
    origin: string;
    cik: number | null;
    wikiSymbol: string | null;
  }>;
  return rows.map((row) => ({ ...row, ticker: row.ticker.toUpperCase(), inSp500: row.inSp500 === 1 }));
}

export function upsertSecurity(
  db: Database.Database,
  row: { ticker: string; name: string | null; inSp500: boolean; origin: string; cik: number | null; wikiSymbol: string | null },
  now: string,
): void {
  const ticker = row.ticker.trim().toUpperCase();
  db.prepare(
    `INSERT INTO screener_security (ticker, name, in_sp500, origin, cik, wiki_symbol, created_at, updated_at)
     VALUES (@ticker, @name, @inSp500, @origin, @cik, @wikiSymbol, @now, @now)
     ON CONFLICT(ticker) DO UPDATE SET
       name = COALESCE(excluded.name, screener_security.name),
       in_sp500 = CASE WHEN excluded.in_sp500 = 1 THEN 1 ELSE screener_security.in_sp500 END,
       origin = CASE WHEN screener_security.origin = 'user' THEN screener_security.origin ELSE excluded.origin END,
       cik = COALESCE(screener_security.cik, excluded.cik),
       wiki_symbol = COALESCE(screener_security.wiki_symbol, excluded.wiki_symbol),
       updated_at = excluded.updated_at`,
  ).run({
    ticker,
    name: row.name,
    inSp500: row.inSp500 ? 1 : 0,
    origin: row.origin,
    cik: row.cik,
    wikiSymbol: row.wikiSymbol,
    now,
  });
}

export function addUserTicker(db: Database.Database, ticker: string, now: string): { ok: true } | { ok: false; error: string } {
  const symbol = ticker.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.-]{0,9}$/.test(symbol)) return { ok: false, error: "Enter a ticker such as AAPL or BRK-B." };
  const existing = db.prepare(`SELECT ticker FROM screener_security WHERE ticker = ?`).get(symbol);
  if (existing) return { ok: false, error: `${symbol} is already in the universe.` };
  db.prepare(
    `INSERT INTO screener_security (ticker, name, in_sp500, origin, cik, wiki_symbol, created_at, updated_at)
     VALUES (?, NULL, 0, 'user', NULL, NULL, ?, ?)`,
  ).run(symbol, now, now);
  return { ok: true };
}

function parseMeta(text: string | null): Record<string, unknown> | null {
  if (!text) return null;
  try {
    const value = JSON.parse(text) as unknown;
    return value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

export function listObservations(db: Database.Database): StoredObservation[] {
  const rows = db
    .prepare(
      `SELECT ticker, field, source, value_num AS valueNum, value_text AS valueText, as_of AS asOf, fetched_at AS fetchedAt, source_url AS sourceUrl, meta_json AS metaJson
       FROM screener_observation`,
    )
    .all() as Array<{
    ticker: string;
    field: StoredObservation["field"];
    source: string;
    valueNum: number | null;
    valueText: string | null;
    asOf: string | null;
    fetchedAt: string;
    sourceUrl: string | null;
    metaJson: string | null;
  }>;
  return rows.map((row) => ({
    ticker: row.ticker.toUpperCase(),
    field: row.field,
    source: row.source,
    valueNum: row.valueNum,
    valueText: row.valueText,
    asOf: row.asOf,
    fetchedAt: row.fetchedAt,
    sourceUrl: row.sourceUrl,
    meta: parseMeta(row.metaJson),
  }));
}

export function upsertObservation(db: Database.Database, ticker: string, input: ObservationInput, fetchedAt: string): void {
  db.prepare(
    `INSERT INTO screener_observation (ticker, field, source, value_num, value_text, as_of, fetched_at, source_url, meta_json)
     VALUES (@ticker, @field, @source, @valueNum, @valueText, @asOf, @fetchedAt, @sourceUrl, @metaJson)
     ON CONFLICT(ticker, field, source) DO UPDATE SET
       value_num = excluded.value_num,
       value_text = excluded.value_text,
       as_of = excluded.as_of,
       fetched_at = excluded.fetched_at,
       source_url = excluded.source_url,
       meta_json = excluded.meta_json`,
  ).run({
    ticker: ticker.trim().toUpperCase(),
    field: input.field,
    source: input.source,
    valueNum: input.valueNum ?? null,
    valueText: input.valueText ?? null,
    asOf: input.asOf ?? null,
    fetchedAt,
    sourceUrl: input.sourceUrl ?? null,
    metaJson: input.meta ? JSON.stringify(input.meta) : null,
  });
}

export type WarEdit = { ticker: string; rating: string | null; sourceUrl: string | null; unverified: boolean; updatedAt: string };

export function listWarEdits(db: Database.Database): WarEdit[] {
  const rows = db
    .prepare(`SELECT ticker, rating, source_url AS sourceUrl, unverified, updated_at AS updatedAt FROM screener_war_edit`)
    .all() as Array<{ ticker: string; rating: string | null; sourceUrl: string | null; unverified: number; updatedAt: string }>;
  return rows.map((row) => ({
    ticker: row.ticker.toUpperCase(),
    rating: row.rating,
    sourceUrl: row.sourceUrl,
    unverified: row.unverified === 1,
    updatedAt: row.updatedAt,
  }));
}

export function saveWarEdit(
  db: Database.Database,
  edit: { ticker: string; rating: string | null; sourceUrl: string | null; unverified: boolean },
  now: string,
): void {
  db.prepare(
    `INSERT INTO screener_war_edit (ticker, rating, source_url, unverified, updated_at)
     VALUES (@ticker, @rating, @sourceUrl, @unverified, @now)
     ON CONFLICT(ticker) DO UPDATE SET
       rating = excluded.rating,
       source_url = excluded.source_url,
       unverified = excluded.unverified,
       updated_at = excluded.updated_at`,
  ).run({
    ticker: edit.ticker.trim().toUpperCase(),
    rating: edit.rating,
    sourceUrl: edit.sourceUrl,
    unverified: edit.unverified ? 1 : 0,
    now,
  });
}

export function listPresets(db: Database.Database): Array<{ id: string; name: string; filters: ScreenerFilters; builtIn: boolean }> {
  const rows = db
    .prepare(`SELECT id, name, filters_json AS filtersJson, built_in AS builtIn FROM screener_preset ORDER BY built_in DESC, name`)
    .all() as Array<{ id: string; name: string; filtersJson: string; builtIn: number }>;
  return rows.map((row) => ({
    id: row.id,
    name: row.name,
    filters: JSON.parse(row.filtersJson) as ScreenerFilters,
    builtIn: row.builtIn === 1,
  }));
}

export function savePreset(db: Database.Database, preset: { id: string; name: string; filters: ScreenerFilters; builtIn: boolean }, now: string): void {
  db.prepare(
    `INSERT INTO screener_preset (id, name, filters_json, built_in, updated_at)
     VALUES (@id, @name, @filters, @builtIn, @now)
     ON CONFLICT(id) DO UPDATE SET
       name = excluded.name,
       filters_json = excluded.filters_json,
       built_in = excluded.built_in,
       updated_at = excluded.updated_at
     WHERE screener_preset.built_in = 1 OR excluded.built_in = 0`,
  ).run({
    id: preset.id,
    name: preset.name,
    filters: JSON.stringify(preset.filters),
    builtIn: preset.builtIn ? 1 : 0,
    now,
  });
}

export function deletePreset(db: Database.Database, id: string): void {
  db.prepare(`DELETE FROM screener_preset WHERE id = ? AND built_in = 0`).run(id);
}

export function cacheGet(db: Database.Database, key: string, nowMs: number): string | null {
  const row = db.prepare(`SELECT body, expires_at AS expiresAt FROM screener_http_cache WHERE cache_key = ?`).get(key) as
    | { body: string; expiresAt: string }
    | undefined;
  if (!row) return null;
  if (Date.parse(row.expiresAt) <= nowMs) return null;
  return row.body;
}

export function cacheSet(db: Database.Database, key: string, body: string, fetchedAt: string, expiresAt: string): void {
  db.prepare(
    `INSERT INTO screener_http_cache (cache_key, body, fetched_at, expires_at)
     VALUES (?, ?, ?, ?)
     ON CONFLICT(cache_key) DO UPDATE SET body = excluded.body, fetched_at = excluded.fetched_at, expires_at = excluded.expires_at`,
  ).run(key, body, fetchedAt, expiresAt);
}

export function quotaCount(db: Database.Database, source: string, day: string): number {
  const row = db.prepare(`SELECT count FROM screener_quota WHERE source = ? AND day = ?`).get(source, day) as { count: number } | undefined;
  return row?.count ?? 0;
}

export function quotaAdd(db: Database.Database, source: string, day: string): number {
  db.prepare(
    `INSERT INTO screener_quota (source, day, count) VALUES (?, ?, 1)
     ON CONFLICT(source, day) DO UPDATE SET count = count + 1`,
  ).run(source, day);
  return quotaCount(db, source, day);
}

export function replaceAdjustedCloses(
  db: Database.Database,
  source: string,
  symbol: string,
  bars: Array<{ date: string; adjClose: number }>,
  fetchedAt: string,
): void {
  const insert = db.prepare(
    `INSERT INTO screener_adj_close (source, symbol, date, adj_close, fetched_at)
     VALUES (?, ?, ?, ?, ?)
     ON CONFLICT(source, symbol, date) DO UPDATE SET adj_close = excluded.adj_close, fetched_at = excluded.fetched_at`,
  );
  const tx = db.transaction(() => {
    for (const bar of bars) insert.run(source, symbol.toUpperCase(), bar.date, bar.adjClose, fetchedAt);
  });
  tx();
}

export function listAdjustedCloses(db: Database.Database, source: string, symbol: string): Array<{ date: string; adjClose: number }> {
  return db
    .prepare(
      `SELECT date, adj_close AS adjClose FROM screener_adj_close WHERE source = ? AND symbol = ? ORDER BY date`,
    )
    .all(source, symbol.toUpperCase()) as Array<{ date: string; adjClose: number }>;
}
