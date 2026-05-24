import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import {
  filterSeriesToSessionYmd,
  glanceSessionYmd,
  isoDateInUsEastern,
  schwabIntradayWindowForGlance,
  yahooIntradayRangeForGlance,
} from "@/lib/market/glanceSession";
import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";
import { fetchYahooIntradayChart } from "@/lib/market/yahooChartFetch";
import type { UsMarketIndexCard } from "@/lib/market/usMarketIndices";
import { normalizeSeriesForChart } from "@/lib/market/usMarketIndices";
import { notPosterityWhereSql } from "@/lib/posterity";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
import { ensureCandles, getCachedCandles } from "@/lib/terminal/ohlcv";
import { latestSnapshotIds } from "@/lib/holdings/latestSnapshots";
import { latestSnapshotId } from "@/lib/snapshots";

const PORTFOLIO_INDEX_BASE = 100;
const REFERENCE_SYMBOL = "SPY";
const QUOTE_BATCH = 100;
const CANDLE_CONCURRENCY = 8;

export type PortfolioGlanceCard = Omit<UsMarketIndexCard, "id"> & { id: "portfolio" };

type TimedClose = { tsMs: number; close: number };

type QuotePrices = { last: number; close: number };

/** Priced leg: shares/contracts × live or intraday price. */
type PricedLeg = {
  quantity: number;
  prevClose: number;
  last: number;
  bars: TimedClose[];
  /** Fallback flat MV when intraday bars are missing (keeps weight in totals). */
  flatMv: number;
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

function quotePricesFromObject(q: Record<string, unknown> | null): QuotePrices | null {
  if (!q) return null;
  const rawLast = asNum(q.lastPrice);
  const mark = asNum(q.mark);
  const close = asNum(q.closePrice);
  const last = schwabQuoteDisplayPrice(rawLast, mark, close);
  if (last == null || close == null || close === 0) return null;
  return { last, close };
}

async function fetchSchwabQuoteObjects(symbols: string[]): Promise<Map<string, Record<string, unknown>>> {
  const out = new Map<string, Record<string, unknown>>();
  const uniq = [...new Set(symbols.map(normSym).filter(Boolean))];
  for (let i = 0; i < uniq.length; i += QUOTE_BATCH) {
    const batch = uniq.slice(i, i + QUOTE_BATCH);
    try {
      const resp = await schwabMarketFetch<Record<string, unknown>>(
        `/quotes?symbols=${encodeURIComponent(batch.join(","))}`,
      );
      for (const sym of batch) {
        const q = schwabQuoteObjectFromEntry(resp[sym] ?? resp[sym.toUpperCase()]);
        if (q) out.set(sym, q);
      }
    } catch (e) {
      logError("portfolio_glance_quotes_batch", e);
    }
  }
  return out;
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

type PositionRow = {
  security_type: string;
  symbol: string | null;
  quantity: number;
  market_value: number;
};

function latestSnapshotIdsForPortfolio(): string[] {
  const db = getDb();
  const snaps = latestSnapshotIds(db, "all_synced");
  const snapFallback = latestSnapshotId(db);
  return snaps.length ? snaps : snapFallback ? [snapFallback] : [];
}

function loadPositionRows(snapshotIds: string[]): PositionRow[] {
  const db = getDb();
  return db
    .prepare(
      `
      SELECT
        s.security_type AS security_type,
        s.symbol AS symbol,
        SUM(p.quantity) AS quantity,
        SUM(COALESCE(p.market_value, 0)) AS market_value
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snaps))
      GROUP BY s.id, s.security_type, s.symbol
    `,
    )
    .all({ snaps: JSON.stringify(snapshotIds) }) as PositionRow[];
}

function legPrevCloseValue(leg: PricedLeg): number {
  if (leg.quantity !== 0 && leg.prevClose > 0) return leg.quantity * leg.prevClose;
  return leg.flatMv;
}

function legLastValue(leg: PricedLeg): number {
  if (leg.quantity !== 0 && leg.last > 0) return leg.quantity * leg.last;
  return leg.flatMv;
}

function legValueAt(leg: PricedLeg, tsMs: number): number {
  if (leg.quantity !== 0) {
    const px = priceAtOrBefore(leg.bars, tsMs, leg.prevClose);
    return leg.quantity * px;
  }
  return leg.flatMv;
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

/** Holdings-weighted intraday path (indexed to 100 at prior close). */
export async function fetchPortfolioGlanceCard(now: Date = new Date()): Promise<PortfolioGlanceCard> {
  try {
    const sessionYmd = glanceSessionYmd(now);
    const schwabWindow = schwabIntradayWindowForGlance(now);
    const snapshotIds = latestSnapshotIdsForPortfolio();
    if (snapshotIds.length === 0) return emptyPortfolioCard();

    const rows = loadPositionRows(snapshotIds);
    if (rows.length === 0) return emptyPortfolioCard();

    const equityQty = new Map<string, number>();
    const equitySyncedMv = new Map<string, number>();
    const optionRows: Array<{ symbol: string; quantity: number; syncedMv: number }> = [];
    let flatMv = 0;

    for (const row of rows) {
      const mv = row.market_value;
      if (!Number.isFinite(mv) || mv === 0) continue;
      const qty = row.quantity;
      const type = (row.security_type ?? "").toLowerCase();

      if (type === "cash") {
        flatMv += mv;
        continue;
      }

      const sym = normSym(row.symbol ?? "");
      if (!sym || sym === "CASH") {
        flatMv += mv;
        continue;
      }

      if (type === "equity" || type === "fund") {
        equityQty.set(sym, (equityQty.get(sym) ?? 0) + qty);
        equitySyncedMv.set(sym, (equitySyncedMv.get(sym) ?? 0) + mv);
        continue;
      }

      if (type === "option") {
        optionRows.push({ symbol: sym, quantity: qty, syncedMv: mv });
        continue;
      }

      flatMv += mv;
    }

    const quoteSymbols = [
      ...equityQty.keys(),
      ...optionRows.map((o) => o.symbol),
    ];
    if (quoteSymbols.length === 0 && flatMv <= 0) return emptyPortfolioCard();

    await Promise.all([
      ensureCandles(REFERENCE_SYMBOL, "5m", schwabWindow).catch((e) =>
        logError("portfolio_glance_spy_candles", e),
      ),
    ]);

    const quotes = await fetchSchwabQuoteObjects(quoteSymbols);

    const equitySymbols = [...equityQty.keys()];
    for (let i = 0; i < equitySymbols.length; i += CANDLE_CONCURRENCY) {
      const batch = equitySymbols.slice(i, i + CANDLE_CONCURRENCY);
      await Promise.all(
        batch.map((sym) =>
          ensureCandles(sym, "5m", schwabWindow).catch((e) => logError(`portfolio_glance_candles_${sym}`, e)),
        ),
      );
    }

    const legs: PricedLeg[] = [];

    for (const [sym, qty] of equityQty.entries()) {
      const syncedMv = equitySyncedMv.get(sym) ?? 0;
      const prices = quotePricesFromObject(quotes.get(sym) ?? null);
      if (prices && qty !== 0) {
        legs.push({
          quantity: qty,
          prevClose: prices.close,
          last: prices.last,
          bars: timedSessionBars(sym, sessionYmd, schwabWindow),
          flatMv: syncedMv,
        });
      } else if (syncedMv > 0) {
        flatMv += syncedMv;
      }
    }

    for (const opt of optionRows) {
      const prices = quotePricesFromObject(quotes.get(opt.symbol) ?? null);
      if (prices && opt.quantity !== 0) {
        legs.push({
          quantity: opt.quantity,
          prevClose: prices.close,
          last: prices.last,
          bars: [],
          flatMv: opt.syncedMv,
        });
      } else if (opt.syncedMv > 0) {
        flatMv += opt.syncedMv;
      }
    }

    if (legs.length === 0 && flatMv <= 0) return emptyPortfolioCard();

    const prevCloseTotal = flatMv + legs.reduce((sum, leg) => sum + legPrevCloseValue(leg), 0);
    const lastTotal = flatMv + legs.reduce((sum, leg) => sum + legLastValue(leg), 0);
    if (prevCloseTotal <= 0) return emptyPortfolioCard();

    const { grid, dataSource: gridSource } = await fetchReferenceSessionGrid(sessionYmd, now, schwabWindow);

    let series: Array<{ idx: number; close: number }> = [];
    if (grid.length >= 2 && legs.some((leg) => leg.quantity !== 0)) {
      const rawValues = grid.map((point) => flatMv + legs.reduce((sum, leg) => sum + legValueAt(leg, point.tsMs), 0));
      series = rawValues.map((value, idx) => ({
        idx,
        close: PORTFOLIO_INDEX_BASE * (value / prevCloseTotal),
      }));
    }

    const previousClose = PORTFOLIO_INDEX_BASE;
    const last = PORTFOLIO_INDEX_BASE * (lastTotal / prevCloseTotal);
    const normalizedSeries = normalizeSeriesForChart(series, previousClose, last);
    const change = last - previousClose;
    const changePct = (change / previousClose) * 100;

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
