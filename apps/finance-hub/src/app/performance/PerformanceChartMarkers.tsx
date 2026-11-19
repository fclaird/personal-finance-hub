"use client";

import { ReferenceLine } from "recharts";

import {
  PERFORMANCE_CHART_MARKERS,
  placePerformanceMarkers,
  type AxisKeyedPoint,
} from "@/lib/charts/performanceMarkers";

type MarkerLabelProps = {
  viewBox?: { x?: number; y?: number };
  text?: string;
};

/**
 * Small latin cross beside the label. Drawn as strokes because the page font
 * (Geist, latin subset) does not include a dagger, and a fallback glyph sits
 * on a different baseline.
 */
function PerformanceMarkerLabel({ viewBox, text }: MarkerLabelProps) {
  if (viewBox?.x == null || viewBox.y == null || !text) return null;
  const lineX = viewBox.x;
  const baseline = viewBox.y + 13;
  const crossW = 7;
  const crossH = 9;
  const gap = 4;
  const placeRight = lineX < 148;
  const crossX = placeRight ? lineX + 5 : lineX - 5 - crossW;
  const textX = placeRight ? crossX + crossW + gap : crossX - gap;
  const crossTop = baseline - crossH;
  const stemX = crossX + crossW / 2;
  return (
    <g className="text-zinc-600 dark:text-zinc-200" pointerEvents="none">
      <title>{text}</title>
      <g stroke="currentColor" fill="none" strokeWidth={1} shapeRendering="crispEdges">
        <line x1={stemX} y1={crossTop} x2={stemX} y2={baseline} />
        <line x1={crossX} y1={crossTop + 3} x2={crossX + crossW} y2={crossTop + 3} />
      </g>
      <text x={textX} y={baseline} textAnchor={placeRight ? "start" : "end"} fontSize={11} fill="currentColor">
        {text}
      </text>
    </g>
  );
}

/** Vertical event lines for whatever span the chart is currently showing. */
export function PerformanceChartMarkers({ points }: { points: readonly AxisKeyedPoint[] }) {
  const placed = placePerformanceMarkers(PERFORMANCE_CHART_MARKERS, points);
  return (
    <>
      {placed.map((marker) => (
        <ReferenceLine
          key={marker.date}
          x={marker.x}
          ifOverflow="discard"
          zIndex={450}
          stroke="currentColor"
          strokeWidth={1}
          strokeDasharray="2 3"
          className="pointer-events-none text-zinc-500 dark:text-zinc-400"
          label={<PerformanceMarkerLabel text={marker.label} />}
        />
      ))}
    </>
  );
}
