import type Database from "better-sqlite3";

import { logError } from "@/lib/log";
import {
  defaultLiveStartedAtIso,
  dividendsForHoldingsInRange,
} from "@/lib/dividends/forwardSnap";
import { addUtcDays, isoDateUtc, iterateUtcDatesInclusive } from "@/lib/dividends/dates";
import { fetchSchwabQuotesNormalized } from "@/lib/dividends/dividendModelQuotes";
import { closeOnOrBeforeTs } from "@/lib/dividends/prices";

import { buildSchwabDividendBook, dividendBookHoldingQuantities } from "./schwabDividendBook";

const BOOK_META_ID = "default";

type HoldingQty = { symbol: string; shares: number };

export function ensureBookLiveStartedAt(db: Database.Database, now: Date = new Date()): string {
  const row = db
    .prepare(`SELECT live_started_at AS liveStartedAt FROM dividend_book_meta WHERE id = ?`)
    .get(BOOK_META_ID) as { liveStartedAt: string | null } | undefined;
  if (row?.liveStartedAt) return row.liveStartedAt;
  const iso = defaultLiveStartedAtIso(now);
  const updatedAt = now.toISOString();
  db.prepare(
    `
    INSERT INTO dividend_book_meta (id, live_started_at, updated_at)
    VALUES (?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET live_started_at = excluded.live_started_at, updated_at = excluded.updated_at
  `,
  ).run(BOOK_META_ID, iso, updatedAt);
  return iso;
}

export function alignBookLiveStartedAtToFirstSnap(db: Database.Database): void {
  const row = db
    .prepare(`SELECT MIN(as_of) AS firstAsOf FROM dividend_book_forward_snap`)
    .get() as { firstAsOf: string | null } | undefined;
  if (!row?.firstAsOf) return;
  const iso = `${row.firstAsOf}T00:00:00.000Z`;
  db.prepare(`UPDATE dividend_book_meta SET live_started_at = ? WHERE id = ?`).run(iso, BOOK_META_ID);
}

export function latestBookSnapAsOf(db: Database.Database): string | null {
  const row = db
    .prepare(`SELECT as_of AS asOf FROM dividend_book_forward_snap ORDER BY as_of DESC LIMIT 1`)
    .get() as { asOf: string } | undefined;
  return row?.asOf ?? null;
}

export function needsBookForwardSnapCapture(db: Database.Database, now: Date = new Date()): boolean {
  const today = isoDateUtc(now);
  const latest = latestBookSnapAsOf(db);
  return latest == null || latest < today;
}

export function hasBookForwardSnapGaps(db: Database.Database, now: Date = new Date()): boolean {
  const liveStartedAt = getBookLiveStartedAt(db);
  if (!liveStartedAt) return false;
  const start = liveStartedAt.slice(0, 10);
  const today = isoDateUtc(now);
  const count = db
    .prepare(`SELECT COUNT(1) AS n FROM dividend_book_forward_snap WHERE as_of >= ? AND as_of <= ?`)
    .get(start, today) as { n: number };
  const expected = iterateUtcDatesInclusive(start, today).length;
  return count.n < expected;
}

function previousBookSnapAsOf(db: Database.Database, asOf: string): string | null {
  const row = db
    .prepare(
      `
      SELECT as_of AS asOf FROM dividend_book_forward_snap
      WHERE as_of < ?
      ORDER BY as_of DESC
      LIMIT 1
    `,
    )
    .get(asOf) as { asOf: string } | undefined;
  return row?.asOf ?? null;
}

function periodStartExclusive(
  db: Database.Database,
  asOf: string,
  liveStartedAt: string,
): string {
  const prevAsOf = previousBookSnapAsOf(db, asOf);
  if (prevAsOf) return prevAsOf;
  const start = liveStartedAt.slice(0, 10);
  return addUtcDays(start, -1);
}

function upsertBookForwardSnapRow(
  db: Database.Database,
  asOf: string,
  nav: number | null,
  divPeriod: number,
  computedAt: string,
  today: string,
): void {
  const status = asOf < today ? "final" : "partial";
  db.prepare(
    `
    INSERT INTO dividend_book_forward_snap (as_of, nav_total, dividends_period, status, computed_at)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(as_of) DO UPDATE SET
      nav_total = excluded.nav_total,
      dividends_period = excluded.dividends_period,
      computed_at = excluded.computed_at,
      status = excluded.status
  `,
  ).run(asOf, nav != null && nav > 0 ? nav : null, divPeriod, status, computedAt);
}

async function computeBookNavForDate(
  db: Database.Database,
  holdings: HoldingQty[],
  asOf: string,
  opts?: { fetchLiveQuotes?: boolean },
): Promise<number> {
  if (holdings.length === 0) return 0;
  const endMs = new Date(`${asOf}T23:59:59.999Z`).getTime();
  let nav = 0;

  if (opts?.fetchLiveQuotes) {
    try {
      const symbols = holdings.map((h) => h.symbol);
      const quotes = await fetchSchwabQuotesNormalized(symbols);
      for (const h of holdings) {
        const q = quotes.get(h.symbol);
        const px = q?.last ?? q?.mark ?? q?.close ?? null;
        if (px != null && Number.isFinite(px) && px > 0) nav += h.shares * px;
      }
    } catch (e) {
      logError("book_forward_snap_quotes", e);
    }
  }

  if (nav <= 0) {
    for (const h of holdings) {
      const px = closeOnOrBeforeTs(db, h.symbol, endMs);
      if (px != null && Number.isFinite(px) && px > 0) nav += h.shares * px;
    }
  }

  return nav;
}

export async function captureBookForwardSnap(
  db: Database.Database,
  now: Date = new Date(),
  opts?: { fetchLiveQuotes?: boolean; asOf?: string },
): Promise<{ ok: boolean; asOf: string }> {
  const { dividendRows } = await buildSchwabDividendBook(db, {
    fetchLiveData: opts?.fetchLiveQuotes === true,
  });
  const withShares = dividendBookHoldingQuantities(dividendRows);
  if (withShares.length === 0) return { ok: false, asOf: "" };

  const liveStartedAt = ensureBookLiveStartedAt(db, now);
  const today = isoDateUtc(now);
  const asOf = opts?.asOf ?? today;
  const computedAt = now.toISOString();

  const nav = await computeBookNavForDate(db, withShares, asOf, {
    fetchLiveQuotes: opts?.fetchLiveQuotes === true && asOf === today,
  });

  const periodStart = periodStartExclusive(db, asOf, liveStartedAt);
  const divPeriod = dividendsForHoldingsInRange(db, withShares, periodStart, asOf);

  upsertBookForwardSnapRow(db, asOf, nav > 0 ? nav : null, divPeriod, computedAt, today);

  db.prepare(`UPDATE dividend_book_meta SET updated_at = ? WHERE id = ?`).run(computedAt, BOOK_META_ID);

  return { ok: true, asOf };
}

export async function backfillBookForwardSnaps(
  db: Database.Database,
  now: Date = new Date(),
): Promise<{ filled: number }> {
  const { dividendRows } = await buildSchwabDividendBook(db, { fetchLiveData: false });
  const withShares = dividendBookHoldingQuantities(dividendRows);
  if (withShares.length === 0) return { filled: 0 };

  const liveStartedAt = ensureBookLiveStartedAt(db, now);
  const start = liveStartedAt.slice(0, 10);
  const today = isoDateUtc(now);
  const existing = new Set(
    (
      db
        .prepare(`SELECT as_of AS asOf FROM dividend_book_forward_snap WHERE as_of >= ? AND as_of <= ?`)
        .all(start, today) as Array<{ asOf: string }>
    ).map((r) => r.asOf),
  );

  let filled = 0;
  const computedAt = now.toISOString();

  for (const asOf of iterateUtcDatesInclusive(start, today)) {
    if (existing.has(asOf)) continue;
    const nav = await computeBookNavForDate(db, withShares, asOf, { fetchLiveQuotes: false });
    const periodStart = periodStartExclusive(db, asOf, liveStartedAt);
    const divPeriod = dividendsForHoldingsInRange(db, withShares, periodStart, asOf);
    upsertBookForwardSnapRow(db, asOf, nav > 0 ? nav : null, divPeriod, computedAt, today);
    filled += 1;
  }

  if (filled > 0) alignBookLiveStartedAtToFirstSnap(db);

  return { filled };
}

export async function syncBookForwardSnaps(
  db: Database.Database,
  now: Date = new Date(),
  opts?: { fetchLiveQuotes?: boolean; backfill?: boolean },
): Promise<{ ok: boolean; asOf: string; backfilled: number }> {
  const backfill = opts?.backfill !== false ? await backfillBookForwardSnaps(db, now) : { filled: 0 };
  const snap = await captureBookForwardSnap(db, now, { fetchLiveQuotes: opts?.fetchLiveQuotes });
  alignBookLiveStartedAtToFirstSnap(db);
  return { ok: snap.ok, asOf: snap.asOf, backfilled: backfill.filled };
}

export function getBookLiveStartedAt(db: Database.Database): string | null {
  const row = db
    .prepare(`SELECT live_started_at AS liveStartedAt FROM dividend_book_meta WHERE id = ?`)
    .get(BOOK_META_ID) as { liveStartedAt: string | null } | undefined;
  return row?.liveStartedAt ?? null;
}
