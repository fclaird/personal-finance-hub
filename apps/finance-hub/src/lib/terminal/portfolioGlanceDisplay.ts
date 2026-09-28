import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import { PORTFOLIO_INDEX_BASE } from "@/lib/terminal/portfolioGlanceConstants";

export type PortfolioGlanceDisplayMode = "indexed" | "dollar";

export function indexToPortfolioDollars(indexValue: number, priorNetValue: number): number {
  if (!Number.isFinite(indexValue) || !Number.isFinite(priorNetValue) || priorNetValue <= 0) {
    return indexValue;
  }
  return priorNetValue * (indexValue / PORTFOLIO_INDEX_BASE);
}

export function portfolioDayUsdPnl(netValue: number | null | undefined, priorNetValue: number | null | undefined): number | null {
  if (netValue == null || priorNetValue == null || !Number.isFinite(netValue) || !Number.isFinite(priorNetValue)) {
    return null;
  }
  return netValue - priorNetValue;
}

/** Client-side remap of portfolio tile data for dollar display mode. */
export function portfolioGlanceItemForDisplayMode(
  item: UsMarketGlanceItem,
  mode: PortfolioGlanceDisplayMode,
): UsMarketGlanceItem {
  if (item.id !== "portfolio" || mode === "indexed") return item;
  const prior = item.priorNetValue;
  if (prior == null || !Number.isFinite(prior) || prior <= 0) return item;

  const mapPoint = (p: { idx: number; close: number; tsMs?: number }) => ({
    ...p,
    close: indexToPortfolioDollars(p.close, prior),
  });

  return {
    ...item,
    valueMode: "price",
    last: item.netValue ?? indexToPortfolioDollars(item.last ?? PORTFOLIO_INDEX_BASE, prior),
    previousClose: prior,
    change: portfolioDayUsdPnl(item.netValue, prior),
    changePct: item.changePct,
    series: item.series.map(mapPoint),
    extendedSeries: item.extendedSeries?.map(mapPoint),
    sessionClose:
      item.sessionClose != null ? indexToPortfolioDollars(item.sessionClose, prior) : item.sessionClose,
    extendedLast:
      item.extendedLast != null ? indexToPortfolioDollars(item.extendedLast, prior) : item.extendedLast,
  };
}

export const PORTFOLIO_SESSION_CLOSE_LABEL = "At close";

export type PortfolioSessionClosePlot = {
  mode: "session_close";
  series: [];
  referencePrice: number | null;
  headlineValue: number | null;
  headlineKind: "index" | "dollars" | "masked";
  changePct: number | null;
  changeLabel: typeof PORTFOLIO_SESSION_CLOSE_LABEL;
};

export type PortfolioGlancePlot = { mode: "live" } | PortfolioSessionClosePlot;

function finiteOrNull(value: number | null | undefined): number | null {
  return value != null && Number.isFinite(value) ? value : null;
}

export function portfolioGlancePlot(args: {
  now: Date;
  item: UsMarketGlanceItem;
  displayMode: PortfolioGlanceDisplayMode;
  balanceUnlocked: boolean;
}): PortfolioGlancePlot {
  if (args.item.id !== "portfolio" || isUsEquityRegularSessionOpen(args.now)) {
    return { mode: "live" };
  }

  const display = portfolioGlanceItemForDisplayMode(args.item, args.displayMode);
  const referencePrice = finiteOrNull(display.previousClose);
  const changePct = finiteOrNull(args.item.changePct);
  const indexClose =
    finiteOrNull(args.item.last) ??
    finiteOrNull(args.item.sessionClose) ??
    finiteOrNull(args.item.previousClose);

  if (args.displayMode === "indexed") {
    return {
      mode: "session_close",
      series: [],
      referencePrice,
      headlineValue: indexClose,
      headlineKind: "index",
      changePct,
      changeLabel: PORTFOLIO_SESSION_CLOSE_LABEL,
    };
  }

  if (!args.balanceUnlocked) {
    return {
      mode: "session_close",
      series: [],
      referencePrice,
      headlineValue: null,
      headlineKind: "masked",
      changePct,
      changeLabel: PORTFOLIO_SESSION_CLOSE_LABEL,
    };
  }

  return {
    mode: "session_close",
    series: [],
    referencePrice,
    headlineValue: finiteOrNull(args.item.netValue),
    headlineKind: "dollars",
    changePct,
    changeLabel: PORTFOLIO_SESSION_CLOSE_LABEL,
  };
}
