import { logError } from "@/lib/log";
import { computeExtendedChange, glanceChartContext } from "@/lib/market/glanceExtendedHours";
import { schwabIntradayWindowForGlance } from "@/lib/market/glanceSession";
import { extendedPhaseForGrid, type GlanceTimedGrid } from "@/lib/market/glanceSessionGrid";
import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";
import type { UsMarketIndexCard } from "@/lib/market/usMarketIndices";
import { normalizeSeriesForChart } from "@/lib/market/usMarketIndices";
import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";
import { schwabMarketFetch } from "@/lib/schwab/client";
import { ensureCandles } from "@/lib/terminal/ohlcv";
import {
  priorNySessionYmd,
  resolvePortfolioAccountTotals,
} from "@/lib/terminal/portfolioAccountTotals";

export const PORTFOLIO_INDEX_BASE = 100;
const REFERENCE_SYMBOL = "SPY";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type PortfolioGlanceCard = Omit<UsMarketIndexCard, "id"> & { id: "portfolio" };

export type OptionLeg = {
  quantity: number;
  closePerShare: number;
  lastPerShare: number;
  thetaPerShare: number | null;
  syncedMv: number;
};

function asNum(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function quotePricesFromObject(q: Record<string, unknown> | null): { last: number; close: number } | null {
  if (!q) return null;
  const rawLast = asNum(q.lastPrice);
  const mark = asNum(q.mark);
  const close = asNum(q.closePrice);
  const last = schwabQuoteDisplayPrice(rawLast, mark, close);
  if (last == null || close == null || close === 0) return null;
  return { last, close };
}

async function fetchSpyQuotePrices(): Promise<{ last: number; close: number } | null> {
  try {
    const resp = await schwabMarketFetch<Record<string, unknown>>(
      `/quotes?symbols=${encodeURIComponent(REFERENCE_SYMBOL)}`,
    );
    const q = schwabQuoteObjectFromEntry(resp[REFERENCE_SYMBOL] ?? resp[REFERENCE_SYMBOL.toUpperCase()]);
    return quotePricesFromObject(q);
  } catch (e) {
    logError("portfolio_glance_spy_quote", e);
    return null;
  }
}

export function optionCloseValue(leg: OptionLeg): number {
  const OPTION_MULTIPLIER = 100;
  if (leg.quantity !== 0 && leg.closePerShare > 0) return leg.quantity * OPTION_MULTIPLIER * leg.closePerShare;
  return leg.syncedMv;
}

export function optionLastValue(leg: OptionLeg): number {
  const OPTION_MULTIPLIER = 100;
  if (leg.quantity !== 0 && leg.lastPerShare > 0) return leg.quantity * OPTION_MULTIPLIER * leg.lastPerShare;
  return leg.syncedMv;
}

/** RTH: interpolate close→live mark; after RTH: live mark, then theta fallback. */
export function optionValueAt(
  leg: OptionLeg,
  tsMs: number,
  rthCloseTsMs: number | null,
  rthOpenTsMs: number | null,
): number {
  const OPTION_MULTIPLIER = 100;
  const atClose = optionCloseValue(leg);
  const atLive = optionLastValue(leg);

  if (rthCloseTsMs == null || tsMs <= rthCloseTsMs) {
    if (
      rthOpenTsMs != null &&
      rthCloseTsMs != null &&
      tsMs > rthOpenTsMs &&
      rthCloseTsMs > rthOpenTsMs &&
      atLive !== atClose
    ) {
      const progress = Math.min(1, Math.max(0, (tsMs - rthOpenTsMs) / (rthCloseTsMs - rthOpenTsMs)));
      return atClose + (atLive - atClose) * progress;
    }
    return atClose;
  }

  if (leg.lastPerShare > 0 && Number.isFinite(atLive)) return atLive;

  if (leg.thetaPerShare == null || !Number.isFinite(leg.thetaPerShare)) return atClose;
  const days = Math.max(0, (tsMs - rthCloseTsMs) / MS_PER_DAY);
  return atClose + leg.quantity * OPTION_MULTIPLIER * leg.thetaPerShare * days;
}

function toIndex(mv: number, prevCloseTotal: number): number {
  return PORTFOLIO_INDEX_BASE * (mv / prevCloseTotal);
}

/** Map SPY session shape onto the portfolio's actual day change. */
export function portfolioIndexFromSpyIndex(
  spyIndex: number,
  spyEndIndex: number,
  portfolioEndIndex: number,
): number {
  if (!Number.isFinite(spyIndex)) return PORTFOLIO_INDEX_BASE;
  const spyMove = spyIndex - PORTFOLIO_INDEX_BASE;
  const spyEndMove = spyEndIndex - PORTFOLIO_INDEX_BASE;
  const portfolioEndMove = portfolioEndIndex - PORTFOLIO_INDEX_BASE;
  if (Math.abs(spyEndMove) < 1e-9) {
    return Math.abs(portfolioEndMove) < 1e-9 ? PORTFOLIO_INDEX_BASE : portfolioEndIndex;
  }
  return PORTFOLIO_INDEX_BASE + portfolioEndMove * (spyMove / spyEndMove);
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
    valueMode: "percent",
    netValue: null,
    priorNetValue: null,
  };
}

/**
 * Portfolio glance from Schwab liquidation/account values plus non-Schwab accounts (529, Plaid, etc.).
 * Intraday chart follows SPY session shape scaled to the portfolio's actual day move.
 */
export async function fetchPortfolioGlanceCard(
  now: Date = new Date(),
  gridOverride?: GlanceTimedGrid,
): Promise<PortfolioGlanceCard> {
  try {
    const ctx = glanceChartContext(now);
    const sessionYmd = ctx.sessionYmd;
    const schwabWindow = schwabIntradayWindowForGlance(now);
    const grid = gridOverride ?? { sessionYmd, regular: [], extended: [], rthCloseTsMs: null };
    const extendedPhase = ctx.showExtended ? (extendedPhaseForGrid(grid) ?? ctx.extendedPhase) : null;

    const totals = await resolvePortfolioAccountTotals(sessionYmd, priorNySessionYmd(sessionYmd));
    if (!totals) return emptyPortfolioCard();

    const { netValue, priorNetValue } = totals;
    const previousClose = PORTFOLIO_INDEX_BASE;
    const lastIndex = toIndex(netValue, priorNetValue);
    const change = lastIndex - previousClose;
    const changePct = (change / previousClose) * 100;

    await ensureCandles(REFERENCE_SYMBOL, "5m", schwabWindow).catch((e) =>
      logError("portfolio_glance_spy_candles", e),
    );
    const spyQuote = (await fetchSpyQuotePrices()) ?? {
      close: grid.regular[0]?.close ?? 0,
      last: grid.regular[grid.regular.length - 1]?.close ?? 0,
    };
    const spyPriorClose = spyQuote.close > 0 ? spyQuote.close : (grid.regular[0]?.close ?? 0);
    if (spyPriorClose <= 0) {
      return {
        id: "portfolio",
        label: "Portfolio",
        symbol: "PORT",
        last: lastIndex,
        change,
        changePct,
        previousClose,
        series: [{ idx: 0, close: previousClose }, { idx: 1, close: lastIndex }],
        dataSource: "schwab",
        valueMode: "percent",
        netValue,
        priorNetValue,
      };
    }

    const spyLastPx =
      spyQuote.last > 0 ? spyQuote.last : (grid.regular[grid.regular.length - 1]?.close ?? spyPriorClose);
    const spyEndIndex = toIndex(spyLastPx, spyPriorClose);
    const rthCloseTsMs = grid.rthCloseTsMs;
    const rthEndIndex =
      rthCloseTsMs != null
        ? portfolioIndexFromSpyIndex(
            toIndex(grid.regular[grid.regular.length - 1]?.close ?? spyLastPx, spyPriorClose),
            spyEndIndex,
            lastIndex,
          )
        : lastIndex;

    let series: Array<{ idx: number; close: number; tsMs?: number }> = [];
    if (grid.regular.length >= 1) {
      series = grid.regular.map((point, idx) => ({
        idx,
        close: portfolioIndexFromSpyIndex(toIndex(point.close, spyPriorClose), spyEndIndex, lastIndex),
        tsMs: point.tsMs,
      }));
    }

    const normalizedSeries = normalizeSeriesForChart(series, previousClose, rthEndIndex);
    const sessionClose =
      normalizedSeries.length > 0 ? normalizedSeries[normalizedSeries.length - 1]!.close : rthEndIndex;

    let extendedSeries: PortfolioGlanceCard["extendedSeries"];
    let extendedChange: number | null = null;
    let extendedChangePct: number | null = null;

    if (ctx.showExtended && grid.extended.length > 0 && rthCloseTsMs != null && normalizedSeries.length > 0) {
      const startIdx = normalizedSeries.length - 1;
      const anchorTs = normalizedSeries[startIdx]!.tsMs ?? rthCloseTsMs;
      const extOut: NonNullable<PortfolioGlanceCard["extendedSeries"]> = [
        { idx: startIdx, close: sessionClose, tsMs: anchorTs },
      ];
      for (const pt of grid.extended) {
        if (pt.tsMs <= rthCloseTsMs) continue;
        extOut.push({
          idx: startIdx + extOut.length,
          close: portfolioIndexFromSpyIndex(toIndex(pt.close, spyPriorClose), spyEndIndex, lastIndex),
          tsMs: pt.tsMs,
        });
      }
      if (extOut.length >= 2) {
        extendedSeries = extOut;
        const extCh = computeExtendedChange(sessionClose, extOut[extOut.length - 1]!.close);
        extendedChange = extCh.extendedChange;
        extendedChangePct = extCh.extendedChangePct;
      }
    }

    return {
      id: "portfolio",
      label: "Portfolio",
      symbol: "PORT",
      last: lastIndex,
      change,
      changePct,
      previousClose,
      series: normalizedSeries,
      dataSource: "schwab",
      valueMode: "percent",
      netValue,
      priorNetValue,
      extendedSeries,
      sessionClose,
      extendedLast: extendedSeries?.[extendedSeries.length - 1]?.close ?? null,
      extendedChange,
      extendedChangePct,
      extendedPhase: extendedSeries ? extendedPhase : null,
    };
  } catch (e) {
    logError("portfolio_glance_failed", e);
    return emptyPortfolioCard();
  }
}
