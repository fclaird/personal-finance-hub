import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { newId } from "@/lib/id";

import { loadHeldEquitySymbols } from "./heldSymbols";
import { parseIngestText } from "./parseIngestText";
import { tagSymbolsForIngest } from "./tagSymbols";
import type { NewsItem } from "./types";
import { CACTUSJXCK_SOURCE, CACTUSJXCK_SOURCE_LABEL } from "./types";

const RETENTION_DAYS = 30;
const MAX_ROWS = 2000;

export type IngestInput = {
  text: string;
  link?: string | null;
  publishedAt?: string | null;
  source?: string;
};

function isoPubDate(publishedAt?: string | null): string {
  if (publishedAt?.trim()) {
    const t = Date.parse(publishedAt.trim());
    if (Number.isFinite(t)) return new Date(t).toISOString();
  }
  return new Date().toISOString();
}

function sourceLabel(source: string): string {
  if (source === CACTUSJXCK_SOURCE) return CACTUSJXCK_SOURCE_LABEL;
  return source.slice(0, 1).toUpperCase() + source.slice(1);
}

export function pruneNewsFeedItems(db: Database.Database): void {
  db.prepare(
    `DELETE FROM news_feed_items WHERE published_at < datetime('now', '-' || ? || ' days')`,
  ).run(RETENTION_DAYS);
  const row = db.prepare(`SELECT COUNT(*) AS c FROM news_feed_items`).get() as { c: number };
  const excess = (row?.c ?? 0) - MAX_ROWS;
  if (excess > 0) {
    db.prepare(
      `
      DELETE FROM news_feed_items
      WHERE id IN (
        SELECT id FROM news_feed_items
        ORDER BY published_at ASC
        LIMIT ?
      )
    `,
    ).run(excess);
  }
}

export function insertNewsItems(
  db: Database.Database,
  inputs: IngestInput[],
  opts?: { heldSymbols?: string[] },
): { inserted: number; skipped: number } {
  const held = opts?.heldSymbols ?? loadHeldEquitySymbols(db);
  const ins = db.prepare(
    `
    INSERT INTO news_feed_items (
      id, source, title, body, link, published_at, symbols_json, category, content_hash
    ) VALUES (
      @id, @source, @title, @body, @link, @published_at, @symbols_json, 'ingest', @content_hash
    )
  `,
  );
  let inserted = 0;
  let skipped = 0;

  const write = db.transaction(() => {
    for (const input of inputs) {
      const source = (input.source ?? CACTUSJXCK_SOURCE).trim().toLowerCase() || CACTUSJXCK_SOURCE;
      const parsed = parseIngestText(input.text, { link: input.link, source });
      if (!parsed) {
        skipped += 1;
        continue;
      }
      const exists = db
        .prepare(`SELECT 1 FROM news_feed_items WHERE content_hash = ? LIMIT 1`)
        .get(parsed.contentHash);
      if (exists) {
        skipped += 1;
        continue;
      }
      const symbols = tagSymbolsForIngest(parsed.title, parsed.body, held);
      try {
        ins.run({
          id: newId("news"),
          source,
          title: parsed.title,
          body: parsed.body,
          link: parsed.link,
          published_at: isoPubDate(input.publishedAt),
          symbols_json: JSON.stringify(symbols),
          content_hash: parsed.contentHash,
        });
        inserted += 1;
      } catch {
        skipped += 1;
      }
    }
    pruneNewsFeedItems(db);
  });
  write();
  return { inserted, skipped };
}

export function loadRecentNewsItems(
  db: Database.Database,
  opts?: { limit?: number; source?: string },
): NewsItem[] {
  const limit = opts?.limit ?? 80;
  const source = opts?.source?.trim().toLowerCase();
  const rows = source
    ? (db
        .prepare(
          `
        SELECT title, body, link, published_at AS publishedAt, symbols_json AS symbolsJson, category, source
        FROM news_feed_items
        WHERE source = ?
        ORDER BY published_at DESC
        LIMIT ?
      `,
        )
        .all(source, limit) as Array<{
        title: string;
        body: string | null;
        link: string;
        publishedAt: string;
        symbolsJson: string;
        category: string;
        source: string;
      }>)
    : (db
        .prepare(
          `
        SELECT title, body, link, published_at AS publishedAt, symbols_json AS symbolsJson, category, source
        FROM news_feed_items
        ORDER BY published_at DESC
        LIMIT ?
      `,
        )
        .all(limit) as Array<{
        title: string;
        body: string | null;
        link: string;
        publishedAt: string;
        symbolsJson: string;
        category: string;
        source: string;
      }>);

  return rows.map((r) => {
    let symbols: string[] = [];
    try {
      const parsed = JSON.parse(r.symbolsJson) as unknown;
      if (Array.isArray(parsed)) {
        symbols = parsed.filter((x): x is string => typeof x === "string").map((s) => s.toUpperCase());
      }
    } catch {
      /* ignore */
    }
    const pub = r.publishedAt?.includes("T")
      ? new Date(r.publishedAt).toUTCString()
      : r.publishedAt;
    return {
      title: r.title,
      link: r.link,
      pubDate: pub,
      symbols,
      category: r.category || "ingest",
      source: sourceLabel(r.source),
      body: r.body ?? undefined,
    };
  });
}

export function ingestNewsPosts(inputs: IngestInput[]): { inserted: number; skipped: number } {
  const db = getDb();
  return insertNewsItems(db, inputs);
}
