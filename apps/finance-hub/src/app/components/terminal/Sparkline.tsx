"use client";

import { useId } from "react";

const UP = "#10b981";
const DOWN = "#f87171";

function finiteValues(values: readonly number[]): number[] {
  return values.filter((v) => typeof v === "number" && Number.isFinite(v));
}

/** Lightweight inline-SVG intraday sparkline (no chart lib). Color follows day % when provided. */
export function Sparkline({
  values,
  width = 76,
  height = 26,
  changePct = null,
  strokeWidth = 1.5,
}: {
  values: readonly number[];
  width?: number;
  height?: number;
  changePct?: number | null;
  strokeWidth?: number;
}) {
  const gradientId = useId();
  const pts = finiteValues(values);

  if (pts.length < 2) {
    return (
      <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden className="opacity-30" />
    );
  }

  const min = Math.min(...pts);
  const max = Math.max(...pts);
  const span = max - min || 1;
  const padY = strokeWidth + 1;
  const usableH = height - padY * 2;
  const stepX = (width - 4) / (pts.length - 1);
  const yFor = (v: number) => padY + (1 - (v - min) / span) * usableH;

  const coords = pts.map((v, i) => [2 + i * stepX, yFor(v)] as const);

  const linePath = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(2)},${y.toFixed(2)}`).join(" ");
  const areaPath = `${linePath} L${coords[coords.length - 1]![0].toFixed(2)},${height} L${coords[0]![0].toFixed(2)},${height} Z`;

  const slope =
    changePct != null && Number.isFinite(changePct) ? changePct : pts[pts.length - 1]! - pts[0]!;
  const color = slope >= 0 ? UP : DOWN;

  return (
    <svg
      width={width}
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      aria-hidden
    >
      <defs>
        <linearGradient id={gradientId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={color} stopOpacity={0.28} />
          <stop offset="100%" stopColor={color} stopOpacity={0} />
        </linearGradient>
      </defs>
      <path d={areaPath} fill={`url(#${gradientId})`} stroke="none" />
      <path
        d={linePath}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinejoin="round"
        strokeLinecap="round"
      />
    </svg>
  );
}
