import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
import { formatGlanceSessionLabel, glanceSessionYmd, glanceSessionUsesPriorDay } from "@/lib/market/glanceSession";
import { fetchCanonicalGlanceGrid } from "@/lib/market/glanceSessionGrid";
import { normalizeSchwabQuoteSymbol } from "@/lib/market/schwabSymbol";
import { buildSymbolGlanceCard } from "@/lib/market/usMarketIndices";
import {
  formatGlanceCombinedChartTime,
  indexedGlanceValueToRebasedPct,
  mergeGlanceSeriesForChart,
} from "@/lib/terminal/marketGlanceChart";

export type SymbolPerformanceIntradayPoint = {
  tsMs: number | null;
  label: string;
} & Record<string, number | null>;

export async function fetchSymbolPerformanceIntraday(
  symbols: string[],
  now: Date = new Date(),
): Promise<{
  sessionYmd: string;
  sessionLabel: string;
  showingPriorSession: boolean;
  points: SymbolPerformanceIntradayPoint[];
}> {
  const normalized = [...new Set(symbols.map((s) => normalizeSchwabQuoteSymbol(s)).filter(Boolean))];
  const sessionYmd = glanceSessionYmd(now);
  const grid = await fetchCanonicalGlanceGrid(sessionYmd, now);
  const cards = await Promise.all(
    normalized.map((symbol) => buildSymbolGlanceCard({ id: symbol, label: symbol, symbol }, now, grid)),
  );
  const items: UsMarketGlanceItem[] = cards.map((card) => ({
    ...card,
    id: card.symbol.toUpperCase(),
  }));
  const merged = mergeGlanceSeriesForChart(items);
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
    points,
  };
}
