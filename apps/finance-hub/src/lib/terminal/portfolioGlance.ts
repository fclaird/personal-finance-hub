import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import {
  filterSeriesToSessionYmd,
  glanceSessionYmd,
  isoDateInUsEastern,
  schwabIntradayWindowForGlance,
  yahooIntradayRangeForGlance,
} from "@/lib/market/glanceSession";
import { fetchYahooIntradayChart } from "@/lib/market/yahooChartFetch";
import type { UsMarketIndexCard } from "@/lib/market/usMarketIndices";
import { normalizeSeriesForChart } from "@/lib/market/usMarketIndices";
import { notPosterityWhereSql } from "@/lib/posterity";
import { schwabMarketFetch } from "@/lib/schwab/client";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
import { ensureCandles, getCachedCandles } from "@/lib/terminal/ohlcv";
import { latestSnapshotId } from "@/lib/snapshots";

const PORTFOLIO_INDEX_BASE = 100;
const REFERENCE_SYMBOL = "SPY";
const MAX_HOLDINGS = 48;

export type PortfolioGlanceCard = Omit<UsMarketIndexCard, "id"> & { id: "portfolio" };

type TimedClose = { tsMs: number; close: number };

type PortfolioLeg = {
  prevMv: number;
  prevClose: number;
  last: number;
  bars: TimedClose[];
};

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function schwabSinceMs(window: "1D" | "5D"): number {
  return Date.now() - (window === "5D" ? 8 : 2) * 24 * 60 * 60 * 1000;
}

function timedSessionBars(symbol: string, sessionYmd: string, window: "1D" | "5D"): TimedClose[] {
  const candles = getCachedCandles(symbol, "5m", schwabSinceMs(window));
  if (candles.length === 0) return [];
  const session = filterSeriesToSessionYmd(candles, sessionYmd);
  const use = session.length >= 2 ? session : candles.slice(-78);
  return use.map((c) => ({ tsMs: c.tsMs, close: c.close }));
}

function priceAtOrBefore(bars: TimedClose[], tsMs: number, fallback: number): number {
  if (bars.length === 0) return fallback;
  let lo = 0;
  let hi = bars.length - 1;
  let best = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >> 1;
    if (bars[mid]!.tsMs <= tsMs) {
      best = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return best >= 0 ? bars[best]!.close : fallback;
}

async function fetchReferenceSessionGrid(
  sessionYmd: string,
  now: Date,
  schwabWindow: "1D" | "5D",
): Promise<{ grid: TimedClose[]; dataSource: "yahoo" | "schwab" }> {
  const yahooRange = yahooIntradayRangeForGlance(now);
  const yahoo = await fetchYahooIntradayChart(REFERENCE_SYMBOL, yahooRange);
  if (yahoo?.result) {
    const quote = (yahoo.result.indicators as Record<string, unknown> | undefined)?.quote as
      | Array<Record<string, unknown>>
      | undefined;
    const q0 = quote?.[0];
    const closes = (q0?.close as Array<number | null> | undefined) ?? [];
    const timestamps = (yahoo.result.timestamp as number[] | undefined) ?? [];
    const out: TimedClose[] = [];
    for (let i = 0; i < closes.length; i++) {
      const c = closes[i];
      const ts = timestamps[i];
      if (c == null || ts == null || !Number.isFinite(c)) continue;
      if (isoDateInUsEastern(ts * 1000) !== sessionYmd) continue;
      out.push({ tsMs: ts * 1000, close: c });
    }
    if (out.length >= 2) return { grid: out, dataSource: "yahoo" };
  }

  await ensureCandles(REFERENCE_SYMBOL, "5m", schwabWindow);
  const candles = getCachedCandles(REFERENCE_SYMBOL, "5m", schwabSinceMs(schwabWindow));
  const session = filterSeriesToSessionYmd(candles, sessionYmd);
  const use = session.length >= 2 ? session : candles.slice(-78);
  return {
    grid: use.map((c) => ({ tsMs: c.tsMs, close: c.close })),
    dataSource: "schwab",
  };
}

function mvBySymbolFromDb(): Map<string, number> {
  const db = getDb();
  const snaps = (
    db
      .prepare(
        `
      SELECT hs.id AS snapshot_id
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      WHERE a.id LIKE 'schwab_%'
        AND ${notPosterityWhereSql("a")}
        AND hs.as_of = (
          SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
        )
      ORDER BY a.name ASC
    `,
      )
      .all() as Array<{ snapshot_id: string }>
  ).map((r) => r.snapshot_id);

  const snapFallback = latestSnapshotId(db);
  const snapshotIds = snaps.length ? snaps : snapFallback ? [snapFallback] : [];
  if (snapshotIds.length === 0) return new Map();

  const rows = db
    .prepare(
      `
      SELECT s.symbol AS symbol, SUM(COALESCE(p.market_value, 0)) AS mv
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
        AND s.security_type != 'cash'
        AND s.symbol IS NOT NULL
      GROUP BY s.symbol
    `,
    )
    .all({ snaps: JSON.stringify(snapshotIds) }) as Array<{ symbol: string; mv: number }>;

  const mvBySym = new Map<string, number>();
  for (const r of rows) {
    const sym = normSym(r.symbol);
    if (!sym || sym === "CASH") continue;
    const mv = r.mv;
    if (!Number.isFinite(mv) || mv === 0) continue;
    mvBySym.set(sym, (mvBySym.get(sym) ?? 0) + mv);
  }
  return mvBySym;
}

function emptyPortfolioCard(): PortfolioGlanceCard {
  return {
    id: "portfolio",
    label: "Portfolio",
    symbol: "PORT",
    last: null,
    change: null,
    changePct: null,
    previousClose: PORTFOLIO_INDEX_BASE,
    series: [],
    dataSource: "schwab",
  };
}

/** MV-weighted portfolio intraday path (indexed to 100 at session start). */
export async function fetchPortfolioGlanceCard(now: Date = new Date()): Promise<PortfolioGlanceCard> {
  try {
    const sessionYmd = glanceSessionYmd(now);
    const schwabWindow = schwabIntradayWindowForGlance(now);
    const mvBySym = mvBySymbolFromDb();
    if (mvBySym.size === 0) return emptyPortfolioCard();

    const ranked = [...mvBySym.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_HOLDINGS);
    const symbols = ranked.map(([sym]) => sym);

    await Promise.all([
      ensureCandles(REFERENCE_SYMBOL, "5m", schwabWindow).catch((e) =>
        logError("portfolio_glance_spy_candles", e),
      ),
      ...symbols.map((sym) =>
        ensureCandles(sym, "5m", schwabWindow).catch((e) => logError(`portfolio_glance_candles_${sym}`, e)),
      ),
    ]);

    const resp = await schwabMarketFetch<Record<string, unknown>>(
      `/quotes?symbols=${encodeURIComponent(symbols.join(","))}`,
    );

    const legs: PortfolioLeg[] = [];
    for (const [sym, mv] of ranked) {
      const entry = resp[sym] ?? resp[sym.toUpperCase()];
      const q = schwabQuoteObjectFromEntry(entry);
      if (!q) continue;

      const last = asNum(q.lastPrice) ?? asNum(q.mark);
      const prevClose = asNum(q.closePrice);
      if (last == null || prevClose == null || prevClose === 0) continue;

      const prevMv = mv / (last / prevClose);
      if (!Number.isFinite(prevMv) || prevMv <= 0) continue;

      legs.push({
        prevMv,
        prevClose,
        last,
        bars: timedSessionBars(sym, sessionYmd, schwabWindow),
      });
    }

    if (legs.length === 0) return emptyPortfolioCard();

    const { grid, dataSource: gridSource } = await fetchReferenceSessionGrid(sessionYmd, now, schwabWindow);
    if (grid.length < 2) return emptyPortfolioCard();

    const sessionStartTotal = legs.reduce((sum, leg) => sum + leg.prevMv, 0);
    const rawValues: number[] = [];
    for (const point of grid) {
      let total = 0;
      for (const leg of legs) {
        const px = priceAtOrBefore(leg.bars, point.tsMs, leg.prevClose);
        total += leg.prevMv * (px / leg.prevClose);
      }
      rawValues.push(total);
    }

    const base = sessionStartTotal > 0 ? sessionStartTotal : rawValues[0] ?? 1;
    const series = rawValues.map((value, idx) => ({
      idx,
      close: PORTFOLIO_INDEX_BASE * (value / base),
    }));

    let quoteTotal = 0;
    for (const leg of legs) {
      quoteTotal += leg.prevMv * (leg.last / leg.prevClose);
    }
    const previousClose = PORTFOLIO_INDEX_BASE;
    const last = sessionStartTotal > 0 ? PORTFOLIO_INDEX_BASE * (quoteTotal / sessionStartTotal) : previousClose;
    const normalizedSeries = normalizeSeriesForChart(series, previousClose, last);
    const change = last - previousClose;
    const changePct = previousClose !== 0 ? (change / previousClose) * 100 : null;

    return {
      id: "portfolio",
      label: "Portfolio",
      symbol: "PORT",
      last,
      change,
      changePct,
      previousClose,
      series: normalizedSeries,
      dataSource: gridSource,
    };
  } catch (e) {
    logError("portfolio_glance_failed", e);
    return emptyPortfolioCard();
  }
}
