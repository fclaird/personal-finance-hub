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

export const PORTFOLIO_SESSION_CLOSE_LABEL = "At close" as const;
export const PORTFOLIO_PREVIOUS_CLOSE_LABEL = "Previous close" as const;

export type PortfolioSessionClosePlot = {
  mode: "session_close";
  series: [];
  referencePrice: number | null;
  /** Price printed on the line. Null while the dollar balance is locked. */
  shownReferencePrice: number | null;
  headlineValue: number | null;
  headlineKind: "index" | "dollars" | "masked";
  headlineLabel: typeof PORTFOLIO_PREVIOUS_CLOSE_LABEL;
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

  const changePct = finiteOrNull(args.item.changePct);
  const indexClose =
    finiteOrNull(args.item.last) ??
    finiteOrNull(args.item.sessionClose) ??
    finiteOrNull(args.item.previousClose);
  const dollarClose = finiteOrNull(args.item.netValue);
  const shared = {
    mode: "session_close" as const,
    series: [] as [],
    changePct,
    headlineLabel: PORTFOLIO_PREVIOUS_CLOSE_LABEL,
    changeLabel: PORTFOLIO_SESSION_CLOSE_LABEL,
  };

  if (args.displayMode === "indexed") {
    return {
      ...shared,
      referencePrice: indexClose,
      shownReferencePrice: indexClose,
      headlineValue: indexClose,
      headlineKind: "index",
    };
  }

  if (!args.balanceUnlocked) {
    return {
      ...shared,
      referencePrice: dollarClose,
      shownReferencePrice: null,
      headlineValue: null,
      headlineKind: "masked",
    };
  }

  return {
    ...shared,
    referencePrice: dollarClose,
    shownReferencePrice: dollarClose,
    headlineValue: dollarClose,
    headlineKind: "dollars",
  };
}
