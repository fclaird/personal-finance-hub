"use client";

import { useMemo } from "react";

import { GlanceIntradayOverlayChart } from "@/app/components/terminal/GlanceIntradayOverlayChart";
import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
import type { GlanceTileChartWindowCtx } from "@/lib/market/glanceTileChartWindow";
import { mergeGlanceSeriesForChart, resolveGlanceChartLines } from "@/lib/terminal/marketGlanceChart";

export function MarketGlanceCombinedChart({
  items,
  windowCtx,
  chartYDomain,
}: {
  items: UsMarketGlanceItem[];
  windowCtx: GlanceTileChartWindowCtx;
  chartYDomain?: [number, number];
}) {
  const lines = useMemo(() => resolveGlanceChartLines(items), [items]);
  const chartData = useMemo(() => mergeGlanceSeriesForChart(items, windowCtx), [items, windowCtx]);

  if (chartData.length < 2 || lines.length === 0) {
    return <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">No intraday data for combined chart.</div>;
  }

  const primaryLineId = items.some((i) => i.id === "portfolio") ? "portfolio" : undefined;

  return (
    <div className="mt-3 rounded-xl border border-zinc-300 bg-zinc-50 p-3 dark:border-white/15 dark:bg-zinc-900/80">
      <GlanceIntradayOverlayChart
        items={items}
        lines={lines}
        windowCtx={windowCtx}
        primaryLineId={primaryLineId}
        chartYDomain={chartYDomain}
        height={208}
        className="h-52 w-full min-w-0"
        showLegend
        showFooter
      />
    </div>
  );
}
