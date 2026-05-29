import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { computeExtendedChange, glanceChartContext, isUsEquityOvernightDeadZone } from "@/lib/market/glanceExtendedHours";
import { nyWallTimeMs } from "@/lib/market/futuresGlanceSession";
import { extendedPhaseForGrid, type GlanceTimedGrid } from "@/lib/market/glanceSessionGrid";
import { GLANCE_PREMARKET_START_MIN, GLANCE_RTH_OPEN_MIN } from "@/lib/market/glanceTileChartWindow";
import type { UsMarketIndexCard } from "@/lib/market/usMarketIndices";
import { normalizeSeriesForChart } from "@/lib/market/usMarketIndices";
import {
  priorNySessionYmd,
  resolvePortfolioAccountTotals,
  schwabIntradayTotalsFromDb,
} from "@/lib/terminal/portfolioAccountTotals";
import { portfolioDailyReturnPct } from "@/lib/terminal/portfolioCashFlows";

export const PORTFOLIO_INDEX_BASE = 100;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export type PortfolioGlanceCard = Omit<UsMarketIndexCard, "id"> & { id: "portfolio" };

export type OptionLeg = {
  quantity: number;
  closePerShare: number;
  lastPerShare: number;
  thetaPerShare: number | null;
  syncedMv: number;
};

function toIndex(mv: number, prevCloseTotal: number): number {
  return PORTFOLIO_INDEX_BASE * (mv / prevCloseTotal);
}

/** Map SPY session shape onto the portfolio's actual day change (legacy helper). */
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

/** Schwab-only sync points disagreeing with live totals by more than this → simple open→now line. */
const STALE_INTRADAY_INDEX_GAP = 0.001;

/** Skip flat synthetic extended path when live index barely moved vs session close. */
export function hasMaterialPortfolioExtendedMove(sessionClose: number, lastIndex: number): boolean {
  if (!Number.isFinite(sessionClose) || !Number.isFinite(lastIndex)) return false;
  return Math.abs(lastIndex - sessionClose) >= Math.max(0.02, Math.abs(sessionClose) * 1e-4);
}

/** Add back withdrawal amount after the largest intraday drop so cash flows do not paint a fake loss path. */
function adjustRthTotalsForWithdrawal(
  rthTotals: Array<{ tsMs: number; total: number }>,
  netCashFlow: number,
): Array<{ tsMs: number; total: number }> {
  if (netCashFlow >= 0 || rthTotals.length < 2) return rthTotals;
  const withdrawal = -netCashFlow;
  let dropIdx = -1;
  let maxDrop = 0;
  for (let i = 1; i < rthTotals.length; i++) {
    const drop = rthTotals[i - 1]!.total - rthTotals[i]!.total;
    if (drop > maxDrop) {
      maxDrop = drop;
      dropIdx = i;
    }
  }
  if (dropIdx < 0 || maxDrop < withdrawal * 0.3) return rthTotals;
  return rthTotals.map((pt, i) => ({
    ...pt,
    total: i >= dropIdx ? pt.total + withdrawal : pt.total,
  }));
}

function portfolioTwoPointSeries(
  sessionYmd: string,
  nowMs: number,
  lastIndex: number,
): Array<{ idx: number; close: number; tsMs?: number }> {
  const openMs = nyWallTimeMs(sessionYmd, GLANCE_RTH_OPEN_MIN);
  return [
    { idx: 0, close: PORTFOLIO_INDEX_BASE, tsMs: openMs },
    { idx: 1, close: lastIndex, tsMs: nowMs },
  ];
}

/** Keep intraday shape but scale session return to match cash-flow-adjusted day %. */
function portfolioShapePreservingSeries(
  rthTotals: Array<{ tsMs: number; total: number }>,
  lastIndex: number,
  external: number,
  sessionYmd: string,
  nowMs: number,
): Array<{ idx: number; close: number; tsMs?: number }> {
  const baseMv = rthTotals[0]!.total + external;
  if (!Number.isFinite(baseMv) || baseMv <= 0) {
    return portfolioTwoPointSeries(sessionYmd, nowMs, lastIndex);
  }

  const shape = rthTotals.map((pt, idx) => ({
    idx,
    close: PORTFOLIO_INDEX_BASE * ((pt.total + external) / baseMv),
    tsMs: pt.tsMs,
  }));
  const rawLast = shape[shape.length - 1]!.close;
  if (!Number.isFinite(rawLast) || Math.abs(rawLast) < 1e-9) {
    return portfolioTwoPointSeries(sessionYmd, nowMs, lastIndex);
  }

  const scale = lastIndex / rawLast;
  return shape.map((pt, i) => ({
    ...pt,
    close: i === 0 ? PORTFOLIO_INDEX_BASE : pt.close * scale,
    tsMs: i === shape.length - 1 ? nowMs : pt.tsMs,
  }));
}

/** Build indexed intraday rows from stored Schwab liquidation points (100 = prior close). */
export function buildPortfolioIndexSeries(
  intradayTotals: Array<{ tsMs: number; total: number }>,
  priorNetValue: number,
  netValue: number,
  sessionYmd: string,
  nowMs: number,
  externalCurrent = 0,
  netCashFlow = 0,
): Array<{ idx: number; close: number; tsMs?: number }> {
  const flow = Number.isFinite(netCashFlow) ? netCashFlow : 0;
  const adjustedNetValue = netValue - flow;
  const lastIndex = toIndex(adjustedNetValue, priorNetValue);
  const chartStartMs = nyWallTimeMs(sessionYmd, GLANCE_PREMARKET_START_MIN);
  const external = Number.isFinite(externalCurrent) ? externalCurrent : 0;

  const sessionTotals = intradayTotals.filter((pt) => pt.tsMs >= chartStartMs && pt.tsMs <= nowMs);

  if (sessionTotals.length >= 2) {
    const tailMv = sessionTotals[sessionTotals.length - 1]!.total + external;
    const tailIndex = toIndex(tailMv, priorNetValue);
    const ref = Math.max(Math.abs(lastIndex), 1e-9);
    const staleGap = Math.abs(tailIndex - lastIndex) / ref;
    const useShapePreserve = flow < 0 || staleGap > STALE_INTRADAY_INDEX_GAP;

    if (useShapePreserve) {
      const adjustedTotals = flow < 0 ? adjustRthTotalsForWithdrawal(sessionTotals, flow) : sessionTotals;
      const shaped = portfolioShapePreservingSeries(adjustedTotals, lastIndex, external, sessionYmd, nowMs);
      return shaped;
    }

    const out = sessionTotals.map((pt, idx) => ({
      idx,
      close: toIndex(pt.total + external, priorNetValue),
      tsMs: pt.tsMs,
    }));
    const tail = out[out.length - 1]!;
    tail.close = lastIndex;
    tail.tsMs = nowMs;
    return out;
  }

  return portfolioTwoPointSeries(sessionYmd, nowMs, lastIndex);
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
 * Day % uses live liquidation vs prior-day equity; the sparkline follows stored intraday liquidation points.
 */
export async function fetchPortfolioGlanceCard(
  now: Date = new Date(),
  gridOverride?: GlanceTimedGrid,
): Promise<PortfolioGlanceCard> {
  try {
    const ctx = glanceChartContext(now);
    const sessionYmd = ctx.sessionYmd;
    const grid = gridOverride ?? { sessionYmd, regular: [], extended: [], rthCloseTsMs: null };
    const extendedPhase = ctx.showExtended
      ? (extendedPhaseForGrid(grid, sessionYmd) ?? ctx.extendedPhase)
      : null;
    const nowMs = now.getTime();

    const totals = await resolvePortfolioAccountTotals(sessionYmd, priorNySessionYmd(sessionYmd));
    if (!totals) return emptyPortfolioCard();

    const { netValue, priorNetValue, netCashFlow, adjustedNetValue } = totals;
    const previousClose = PORTFOLIO_INDEX_BASE;
    const lastIndex = toIndex(adjustedNetValue, priorNetValue);
    const change = lastIndex - previousClose;
    const changePct = portfolioDailyReturnPct(netValue, priorNetValue, netCashFlow) ?? change;

    const db = getDb();
    const intradayTotals = schwabIntradayTotalsFromDb(db, sessionYmd);
    const series = buildPortfolioIndexSeries(
      intradayTotals,
      priorNetValue,
      netValue,
      sessionYmd,
      nowMs,
      totals.externalCurrent,
      netCashFlow,
    );
    const normalizedSeries = normalizeSeriesForChart(series, previousClose, lastIndex);

    const sessionClose =
      normalizedSeries.length > 0 ? normalizedSeries[normalizedSeries.length - 1]!.close : lastIndex;

    let extendedSeries: PortfolioGlanceCard["extendedSeries"];
    let extendedChange: number | null = null;
    let extendedChangePct: number | null = null;
    const rthCloseTsMs = grid.rthCloseTsMs;

    if (ctx.showExtended && normalizedSeries.length > 0) {
      const extCh = computeExtendedChange(sessionClose, lastIndex);
      extendedChange = extCh.extendedChange;
      extendedChangePct = extCh.extendedChangePct;
    }

    if (
      ctx.showExtended &&
      grid.extended.length > 0 &&
      rthCloseTsMs != null &&
      normalizedSeries.length > 0 &&
      hasMaterialPortfolioExtendedMove(sessionClose, lastIndex)
    ) {
      const startIdx = normalizedSeries.length - 1;
      const anchorTs = normalizedSeries[startIdx]!.tsMs ?? rthCloseTsMs;
      const extOut: NonNullable<PortfolioGlanceCard["extendedSeries"]> = [
        { idx: startIdx, close: sessionClose, tsMs: anchorTs },
      ];
      const extendedAfterClose = grid.extended.filter(
        (pt) => pt.tsMs > rthCloseTsMs && !isUsEquityOvernightDeadZone(pt.tsMs),
      );
      const extEndTs = extendedAfterClose[extendedAfterClose.length - 1]?.tsMs ?? nowMs;
      const spanMs = Math.max(extEndTs - rthCloseTsMs, 1);
      for (const pt of extendedAfterClose) {
        const progress = Math.min(1, Math.max(0, (pt.tsMs - rthCloseTsMs) / spanMs));
        extOut.push({
          idx: startIdx + extOut.length,
          close: sessionClose + (lastIndex - sessionClose) * progress,
          tsMs: pt.tsMs,
        });
      }
      if (extOut.length >= 2) {
        extendedSeries = extOut;
      }
    }

    const portfolioCard = {
      id: "portfolio" as const,
      label: "Portfolio",
      symbol: "PORT",
      last: lastIndex,
      change,
      changePct,
      previousClose,
      series: normalizedSeries,
      dataSource: "schwab" as const,
      valueMode: "percent" as const,
      netValue,
      priorNetValue,
      extendedSeries,
      sessionClose,
      extendedLast: extendedSeries?.[extendedSeries.length - 1]?.close ?? (ctx.showExtended ? lastIndex : null),
      extendedChange,
      extendedChangePct,
      extendedPhase: extendedSeries ? extendedPhase : null,
    };

    return portfolioCard;
  } catch (e) {
    logError("portfolio_glance_failed", e);
    return emptyPortfolioCard();
  }
}
