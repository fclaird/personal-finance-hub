import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import {
  ADJUSTED_PROVIDER,
  ADJUSTED_SOURCE,
  ADJUSTED_VERSION,
  CORPORATE_ACTIONS,
  adjustedClosesFromYahooChartResult,
  type AdjBar,
} from "@/lib/market/adjustedClose";
import { fetchYahooChartResult, yahooChartSymbol } from "@/lib/market/yahooChartFetch";

const SUCCESS_TTL_MS = 6 * 60 * 60 * 1000;
const FAILURE_TTL_MS = 15 * 60 * 1000;

export type LoadedSeries = {
  readonly symbol: string;
  readonly provider: typeof ADJUSTED_PROVIDER;
  readonly version: typeof ADJUSTED_VERSION;
  readonly corporateActions: typeof CORPORATE_ACTIONS;
  readonly status: "ok" | "no-adjclose" | "unavailable" | "duplicate-date" | "empty" | "nonpositive";
  readonly bars: readonly AdjBar[];
  readonly fetchedAt: string | null;
  readonly source: "memory" | "sqlite" | "yahoo";
};

type MemoryEntry = { readonly at: number; readonly payload: LoadedSeries };

const memory = new Map<string, MemoryEntry>();

function ensureAdjustedTables(db: Database.Database): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS adjusted_return_points (
      provider TEXT NOT NULL,
      symbol TEXT NOT NULL,
      version TEXT NOT NULL,
      date TEXT NOT NULL,
      adj_close REAL NOT NULL,
      PRIMARY KEY (provider, symbol, version, date)
    );
    CREATE TABLE IF NOT EXISTS adjusted_return_meta (
      provider TEXT NOT NULL,
      symbol TEXT NOT NULL,
      version TEXT NOT NULL,
      corporate_actions TEXT NOT NULL,
      source TEXT NOT NULL,
      fetched_at TEXT NOT NULL,
      latest_date TEXT,
      bar_count INTEGER NOT NULL,
      status TEXT NOT NULL,
      PRIMARY KEY (provider, symbol, version)
    );
  `);
}

export function clearAdjustedMemoryCache(): void {
  memory.clear();
}

type MetaRow = {
  fetched_at: string;
  latest_date: string | null;
  bar_count: number;
  status: string;
};

export function writeAdjustedSeries(
  db: Database.Database,
  symbol: string,
  status: LoadedSeries["status"],
  bars: readonly AdjBar[],
  fetchedAt: string,
): void {
  ensureAdjustedTables(db);
  const key = yahooChartSymbol(symbol);
  const tx = db.transaction(() => {
    db.prepare(`DELETE FROM adjusted_return_points WHERE provider = ? AND symbol = ? AND version = ?`).run(ADJUSTED_PROVIDER, key, ADJUSTED_VERSION);
    const insert = db.prepare(
      `INSERT INTO adjusted_return_points (provider, symbol, version, date, adj_close) VALUES (?, ?, ?, ?, ?)`,
    );
    if (status === "ok") {
      for (const bar of bars) insert.run(ADJUSTED_PROVIDER, key, ADJUSTED_VERSION, bar.date, bar.adjClose);
    }
    db.prepare(
      `INSERT INTO adjusted_return_meta (provider, symbol, version, corporate_actions, source, fetched_at, latest_date, bar_count, status)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(provider, symbol, version) DO UPDATE SET
         corporate_actions = excluded.corporate_actions,
         source = excluded.source,
         fetched_at = excluded.fetched_at,
         latest_date = excluded.latest_date,
         bar_count = excluded.bar_count,
         status = excluded.status`,
    ).run(
      ADJUSTED_PROVIDER,
      key,
      ADJUSTED_VERSION,
      CORPORATE_ACTIONS,
      ADJUSTED_SOURCE,
      fetchedAt,
      bars.length > 0 ? bars[bars.length - 1]!.date : null,
      status === "ok" ? bars.length : 0,
      status,
    );
  });
  tx();
}

export function readAdjustedSeries(db: Database.Database, symbol: string): LoadedSeries | null {
  ensureAdjustedTables(db);
  const key = yahooChartSymbol(symbol);
  const meta = db
    .prepare(
      `SELECT fetched_at, latest_date, bar_count, status FROM adjusted_return_meta WHERE provider = ? AND symbol = ? AND version = ?`,
    )
    .get(ADJUSTED_PROVIDER, key, ADJUSTED_VERSION) as MetaRow | undefined;
  if (!meta) return null;
  const rows = db
    .prepare(
      `SELECT date, adj_close FROM adjusted_return_points WHERE provider = ? AND symbol = ? AND version = ? ORDER BY date`,
    )
    .all(ADJUSTED_PROVIDER, key, ADJUSTED_VERSION) as Array<{ date: string; adj_close: number }>;
  const status = meta.status as LoadedSeries["status"];
  return {
    symbol: key,
    provider: ADJUSTED_PROVIDER,
    version: ADJUSTED_VERSION,
    corporateActions: CORPORATE_ACTIONS,
    status,
    bars: rows.map((row) => ({ date: row.date, adjClose: row.adj_close })),
    fetchedAt: meta.fetched_at,
    source: "sqlite",
  };
}

function fresh(entry: LoadedSeries, now: number): boolean {
  if (!entry.fetchedAt) return false;
  const age = now - Date.parse(entry.fetchedAt);
  if (!Number.isFinite(age) || age < 0) return false;
  return entry.status === "ok" ? age < SUCCESS_TTL_MS : age < FAILURE_TTL_MS;
}

function remember(payload: LoadedSeries, now: number): LoadedSeries {
  memory.set(payload.symbol, { at: now, payload });
  return payload;
}

/**
 * One explicit load. Missing symbols are fetched in order through the existing
 * Yahoo throttle. Successes and failures stay on the yahoo-adjusted key.
 * Nothing is written to price_points.
 */
export async function loadAdjustedSeries(symbols: readonly string[], now = Date.now()): Promise<LoadedSeries[]> {
  const unique = [...new Set(symbols.map((symbol) => yahooChartSymbol(symbol)).filter(Boolean))];
  const db = getDb();
  const out: LoadedSeries[] = [];
  for (const symbol of unique) {
    const cached = memory.get(symbol);
    if (cached && fresh(cached.payload, now)) {
      out.push(cached.payload);
      continue;
    }
    const stored = readAdjustedSeries(db, symbol);
    if (stored && fresh(stored, now)) {
      out.push(remember(stored, now));
      continue;
    }
    const fetchedAt = new Date(now).toISOString();
    const downloaded = await fetchYahooChartResult(symbol);
    if (!downloaded) {
      const missing: LoadedSeries = {
        symbol,
        provider: ADJUSTED_PROVIDER,
        version: ADJUSTED_VERSION,
        corporateActions: CORPORATE_ACTIONS,
        status: "unavailable",
        bars: [],
        fetchedAt,
        source: "yahoo",
      };
      writeAdjustedSeries(db, symbol, "unavailable", [], fetchedAt);
      out.push(remember(missing, now));
      continue;
    }
    const parsed = adjustedClosesFromYahooChartResult(downloaded.result);
    const status = parsed.ok ? "ok" : parsed.reason;
    const bars = parsed.ok ? parsed.bars : [];
    writeAdjustedSeries(db, symbol, status, bars, fetchedAt);
    out.push(
      remember(
        {
          symbol,
          provider: ADJUSTED_PROVIDER,
          version: ADJUSTED_VERSION,
          corporateActions: CORPORATE_ACTIONS,
          status,
          bars,
          fetchedAt,
          source: "yahoo",
        },
        now,
      ),
    );
  }
  return out;
}
