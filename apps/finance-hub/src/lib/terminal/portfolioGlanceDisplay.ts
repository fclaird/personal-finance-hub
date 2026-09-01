import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
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
