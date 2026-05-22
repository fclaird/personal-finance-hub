import type Database from "better-sqlite3";

import { logError } from "@/lib/log";
import {
  defaultLiveStartedAtIso,
  dividendsForHoldingsInRange,
} from "@/lib/dividends/forwardSnap";
import { fridayOfUtcWeekContaining } from "@/lib/dividends/dates";
import { fetchSchwabQuotesNormalized } from "@/lib/dividends/dividendModelQuotes";

import { buildSchwabDividendBook, dividendBookHoldingQuantities } from "./schwabDividendBook";

const BOOK_META_ID = "default";

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

export async function captureBookForwardSnap(
  db: Database.Database,
  now: Date = new Date(),
  opts?: { fetchLiveQuotes?: boolean },
): Promise<{ ok: boolean; asOf: string }> {
  const { dividendRows } = await buildSchwabDividendBook(db, {
    fetchLiveData: opts?.fetchLiveQuotes === true,
  });
  const withShares = dividendBookHoldingQuantities(dividendRows);
  if (withShares.length === 0) return { ok: false, asOf: "" };

  const liveStartedAt = ensureBookLiveStartedAt(db, now);
  const asOf = fridayOfUtcWeekContaining(now);
  const computedAt = now.toISOString();

  let nav = 0;
  try {
    const symbols = withShares.map((h) => h.symbol);
    const quotes = await fetchSchwabQuotesNormalized(symbols);
    for (const h of withShares) {
      const q = quotes.get(h.symbol);
      const px = q?.last ?? q?.mark ?? q?.close ?? null;
      if (px != null && Number.isFinite(px) && px > 0) nav += h.shares * px;
    }
  } catch (e) {
    logError("book_forward_snap_quotes", e);
  }

  const prevAsOf = previousBookSnapAsOf(db, asOf);
  let periodStartExclusive: string;
  if (prevAsOf) {
    periodStartExclusive = prevAsOf;
  } else {
    const start = liveStartedAt.slice(0, 10);
    const d = new Date(
      Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10))),
    );
    d.setUTCDate(d.getUTCDate() - 1);
    periodStartExclusive = d.toISOString().slice(0, 10);
  }
  const divPeriod = dividendsForHoldingsInRange(db, withShares, periodStartExclusive, asOf);

  db.prepare(
    `
    INSERT INTO dividend_book_forward_snap (as_of, nav_total, dividends_period, status, computed_at)
    VALUES (?, ?, ?, 'partial', ?)
    ON CONFLICT(as_of) DO UPDATE SET
      nav_total = excluded.nav_total,
      dividends_period = excluded.dividends_period,
      computed_at = excluded.computed_at,
      status = 'partial'
  `,
  ).run(asOf, nav > 0 ? nav : null, divPeriod, computedAt);

  db.prepare(`UPDATE dividend_book_meta SET updated_at = ? WHERE id = ?`).run(computedAt, BOOK_META_ID);

  return { ok: true, asOf };
}

export function getBookLiveStartedAt(db: Database.Database): string | null {
  const row = db
    .prepare(`SELECT live_started_at AS liveStartedAt FROM dividend_book_meta WHERE id = ?`)
    .get(BOOK_META_ID) as { liveStartedAt: string | null } | undefined;
  return row?.liveStartedAt ?? null;
}
