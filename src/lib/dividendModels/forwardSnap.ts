import type Database from "better-sqlite3";

import { logError } from "@/lib/log";

import { fridayOfUtcWeekContaining } from "./dates";
import { fetchSchwabQuotesNormalized } from "./quotes";

const DEFAULT_LIVE_LOOKBACK_DAYS = 7;

type HoldingQty = { symbol: string; shares: number };

/** ISO date string for default live_started_at (7 days ago, UTC midnight). */
export function defaultLiveStartedAtIso(now: Date = new Date()): string {
  const d = new Date(now);
  d.setUTCDate(d.getUTCDate() - DEFAULT_LIVE_LOOKBACK_DAYS);
  return d.toISOString();
}

export function ensureLiveStartedAt(db: Database.Database, portfolioId: string, now: Date = new Date()): string {
  const row = db
    .prepare(`SELECT live_started_at AS liveStartedAt FROM dividend_model_portfolios WHERE id = ?`)
    .get(portfolioId) as { liveStartedAt: string | null } | undefined;
  if (row?.liveStartedAt) return row.liveStartedAt;
  const iso = defaultLiveStartedAtIso(now);
  db.prepare(`UPDATE dividend_model_portfolios SET live_started_at = ? WHERE id = ?`).run(iso, portfolioId);
  return iso;
}

/** Per-share dividend payments × shares for pay_date in (startExclusive, endInclusive]. */
export function dividendsForHoldingsInRange(
  db: Database.Database,
  holdings: HoldingQty[],
  startExclusive: string,
  endInclusive: string,
): number {
  if (holdings.length === 0) return 0;
  const q = db.prepare(
    `
    SELECT COALESCE(SUM(amount), 0) AS s
    FROM symbol_dividend_payments
    WHERE symbol = ? AND pay_date > ? AND pay_date <= ?
  `,
  );
  let total = 0;
  for (const h of holdings) {
    const sym = h.symbol.toUpperCase();
    const row = q.get(sym, startExclusive, endInclusive) as { s: number } | undefined;
    total += Number(row?.s ?? 0) * h.shares;
  }
  return total;
}

/** Cumulative dividends since live start through endInclusive. */
export function dividendsForHoldingsSinceLiveStart(
  db: Database.Database,
  holdings: HoldingQty[],
  liveStartedAt: string,
  endInclusive: string,
): number {
  const start = liveStartedAt.slice(0, 10);
  const dayBefore = new Date(Date.UTC(Number(start.slice(0, 4)), Number(start.slice(5, 7)) - 1, Number(start.slice(8, 10))));
  dayBefore.setUTCDate(dayBefore.getUTCDate() - 1);
  const startExclusive = dayBefore.toISOString().slice(0, 10);
  return dividendsForHoldingsInRange(db, holdings, startExclusive, endInclusive);
}

function previousForwardSnapAsOf(db: Database.Database, portfolioId: string, asOf: string): string | null {
  const row = db
    .prepare(
      `
      SELECT as_of AS asOf
      FROM dividend_model_portfolio_forward_snap
      WHERE portfolio_id = ? AND as_of < ?
      ORDER BY as_of DESC
      LIMIT 1
    `,
    )
    .get(portfolioId, asOf) as { asOf: string } | undefined;
  return row?.asOf ?? null;
}

export async function captureForwardSnapForPortfolio(
  db: Database.Database,
  portfolioId: string,
  now: Date = new Date(),
): Promise<{ ok: boolean; asOf: string }> {
  const holdings = db
    .prepare(`SELECT symbol, shares FROM dividend_model_holdings WHERE portfolio_id = ?`)
    .all(portfolioId) as Array<{ symbol: string; shares: number | null }>;

  const withShares: HoldingQty[] = holdings
    .filter((h) => h.shares != null && Number.isFinite(h.shares) && h.shares! > 0)
    .map((h) => ({ symbol: h.symbol.toUpperCase(), shares: h.shares! }));

  if (withShares.length === 0) return { ok: false, asOf: "" };

  const liveStartedAt = ensureLiveStartedAt(db, portfolioId, now);
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
    logError("forward_snap_quotes", e);
  }

  const prevAsOf = previousForwardSnapAsOf(db, portfolioId, asOf);
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
    INSERT INTO dividend_model_portfolio_forward_snap
      (portfolio_id, as_of, nav_total, dividends_period, status, computed_at, spy_rebased_pct, qqq_rebased_pct)
    VALUES (?, ?, ?, ?, 'partial', ?, NULL, NULL)
    ON CONFLICT(portfolio_id, as_of) DO UPDATE SET
      nav_total = excluded.nav_total,
      dividends_period = excluded.dividends_period,
      computed_at = excluded.computed_at,
      status = 'partial'
  `,
  ).run(portfolioId, asOf, nav > 0 ? nav : null, divPeriod, computedAt);

  return { ok: true, asOf };
}
