"use client";

import type { HeatmapItem } from "@/app/components/HeatmapGrid";
import { TerminalPositionTreemap } from "@/app/components/terminal/TerminalPositionTreemap";
import { TerminalTreemapWeightControls } from "@/app/components/terminal/TerminalTreemapWeightControls";
import type { ExposurePieMetric, ExposureScope, SyntheticChartBasis } from "@/lib/analytics/exposureWeighting";

type Props = {
  heatView: "spy" | "qqq" | "portfolio";
  heatItems: HeatmapItem[];
  companyNamesBySymbol: Map<string, string>;
  treemapScope: ExposureScope;
  onScopeChange: (scope: ExposureScope) => void;
  treemapMetric: ExposurePieMetric;
  onPieMetricChange: (metric: ExposurePieMetric) => void;
  treemapSyntheticBasis: SyntheticChartBasis;
  onSyntheticChartBasisChange: (basis: SyntheticChartBasis) => void;
  treemapMvBySym: Map<string, number>;
  positionMvBySym: Map<string, number>;
  portfolioSizeCaption: string | null;
};

export function PortfolioTreemapSection({
  heatView,
  heatItems,
  companyNamesBySymbol,
  treemapScope,
  onScopeChange,
  treemapMetric,
  onPieMetricChange,
  treemapSyntheticBasis,
  onSyntheticChartBasisChange,
  treemapMvBySym,
  positionMvBySym,
  portfolioSizeCaption,
}: Props) {
  return (
    <>
      <p className="text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">
        Same daily % scale as the heatmap; mid-range moves are stretched so small differences read more clearly.
      </p>
      {heatView === "portfolio" ? (
        <TerminalTreemapWeightControls
          scope={treemapScope}
          onScopeChange={onScopeChange}
          pieMetric={treemapMetric}
          onPieMetricChange={onPieMetricChange}
          syntheticChartBasis={treemapSyntheticBasis}
          onSyntheticChartBasisChange={onSyntheticChartBasisChange}
        />
      ) : null}
      <div className="mt-3">
        <TerminalPositionTreemap
          items={heatItems}
          mvBySymbol={heatView === "portfolio" ? treemapMvBySym : positionMvBySym}
          heatView={heatView}
          companyNamesBySymbol={companyNamesBySymbol}
          portfolioSizeCaption={heatView === "portfolio" ? portfolioSizeCaption : null}
        />
      </div>
    </>
  );
}
