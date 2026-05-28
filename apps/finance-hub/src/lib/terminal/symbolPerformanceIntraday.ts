import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
import { formatGlanceSessionLabel, glanceSessionYmd, glanceSessionUsesPriorDay } from "@/lib/market/glanceSession";
import { fetchCanonicalGlanceGrid } from "@/lib/market/glanceSessionGrid";
import { normalizeSchwabQuoteSymbol } from "@/lib/market/schwabSymbol";
import { usEquitySessionStatus } from "@/lib/market/usEquitySession";
import { buildSymbolGlanceCard } from "@/lib/market/usMarketIndices";
import {
  formatGlanceCombinedChartTime,
  indexedGlanceValueToRebasedPct,
  mergeGlanceSeriesForChart,
} from "@/lib/terminal/marketGlanceChart";
import type { GlanceTileChartWindowCtx } from "@/lib/market/glanceTileChartWindow";

export type SymbolPerformanceIntradayPoint = {
  tsMs: number | null;
  label: string;
} & Record<string, number | string | null>;

export async function fetchSymbolPerformanceIntraday(
  symbols: string[],
  now: Date = new Date(),
): Promise<{
  sessionYmd: string;
  sessionLabel: string;
  showingPriorSession: boolean;
  marketOpen: boolean;
  windowCtx: GlanceTileChartWindowCtx;
  items: UsMarketGlanceItem[];
  points: SymbolPerformanceIntradayPoint[];
}> {
  const normalized = [...new Set(symbols.map((s) => normalizeSchwabQuoteSymbol(s)).filter(Boolean))];
  const sessionYmd = glanceSessionYmd(now);
  const grid = await fetchCanonicalGlanceGrid(sessionYmd, now);
  const session = usEquitySessionStatus(now);
  const windowCtx: GlanceTileChartWindowCtx = {
    marketOpen: session.isOpen,
    sessionYmd,
    nowMs: now.getTime(),
  };
  const cards = await Promise.all(
    normalized.map((symbol) => buildSymbolGlanceCard({ id: symbol, label: symbol, symbol }, now, grid)),
  );
  const items: UsMarketGlanceItem[] = cards.map((card) => ({
    ...card,
    id: card.symbol.toUpperCase(),
  }));
  const merged = mergeGlanceSeriesForChart(items, windowCtx);
  const points: SymbolPerformanceIntradayPoint[] = merged.map((row) => {
    const point: SymbolPerformanceIntradayPoint = {
      tsMs: row.tsMs,
      label: row.tsMs != null ? formatGlanceCombinedChartTime(row.tsMs) : `Point ${row.idx}`,
    };
    for (const symbol of normalized) {
      const key = symbol.toUpperCase();
      point[key] = indexedGlanceValueToRebasedPct(row[key] as number | null);
    }
    return point;
  });

  return {
    sessionYmd,
    sessionLabel: formatGlanceSessionLabel(sessionYmd),
    showingPriorSession: glanceSessionUsesPriorDay(now),
    marketOpen: session.isOpen,
    windowCtx,
    items,
    points,
  };
}
