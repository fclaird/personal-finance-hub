"use client";

import { useRouter } from "next/navigation";
import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
  type SVGProps,
} from "react";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import { SymbolLink } from "@/app/components/SymbolLink";
import { distinctColorForIndex } from "@/lib/charts/pieEarthTones";
import { formatUsd2 } from "@/lib/format";
import { symbolPageHref } from "@/lib/symbolPage";
import { Cell, Pie, PieChart, ResponsiveContainer, Tooltip, type PieLabelRenderProps } from "recharts";

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const RAD = Math.PI / 180;

const PIE_LABEL_OVERRIDES_PREFIX = "financeHub.pieLabelOverrides.v1::";

function readLabelOverrides(storageKey: string): Record<string, string> {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(PIE_LABEL_OVERRIDES_PREFIX + storageKey);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function writeLabelOverrides(storageKey: string, map: Record<string, string>) {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(PIE_LABEL_OVERRIDES_PREFIX + storageKey, JSON.stringify(map));
  } catch {
    /* ignore quota */
  }
}

/** Match Recharts `polarToCartesian` (angle in degrees, 0° = 3 o'clock). */
function polarToCartesian(cx: number, cy: number, radius: number, angleDeg: number) {
  return {
    x: cx + Math.cos(-RAD * angleDeg) * radius,
    y: cy + Math.sin(-RAD * angleDeg) * radius,
  };
}

/**
 * Mid-angle per slice (same order as `data`).
 * Mirrors Recharts defaults startAngle 0, endAngle 360, and padding between sectors.
 */
function approximateMidAngles(values: number[], paddingDeg = 0.5): number[] {
  const startAngle = 0;
  const endAngle = 360;
  const sum = values.reduce((a, b) => a + b, 0);
  if (sum <= 0) return values.map(() => startAngle);
  const n = values.length;
  const totalPad = paddingDeg * n;
  const available = endAngle - startAngle - totalPad;
  let cursor = startAngle + paddingDeg / 2;
  const mids: number[] = [];
  for (const v of values) {
    const span = (v / sum) * available;
    mids.push(cursor + span / 2);
    cursor += span + paddingDeg;
  }
  return mids;
}

/** +1 if label should extend toward +X, -1 toward −X (split left/right sides of pie). */
function lateralSign(midDeg: number): 1 | -1 {
  return Math.cos(-RAD * midDeg) >= 0 ? 1 : -1;
}

/**
 * Estimate chart center and outer radius using the **same** pixel width/height Recharts uses
 * inside ResponsiveContainer (must match margins on PieChart).
 */
function estimatePieLayout(
  chartW: number,
  chartH: number,
  margin: { top: number; right: number; bottom: number; left: number },
  outerFrac: number,
) {
  const innerW = Math.max(0, chartW - margin.left - margin.right);
  const innerH = Math.max(0, chartH - margin.top - margin.bottom);
  const maxRadius = Math.min(innerW, innerH) / 2;
  const cx = margin.left + innerW / 2;
  const cy = margin.top + innerH / 2;
  const outerRadius = maxRadius * outerFrac;
  return { cx, cy, outerRadius, chartW, chartH };
}

/** Vertical band for labels (same math as fitElbowText). */
function labelYBand(chartH: number, labelFontPx: number) {
  const pad = Math.max(6, labelFontPx * 0.35);
  return { minY: pad + labelFontPx * 0.55, maxY: chartH - pad - labelFontPx * 0.55 };
}

/** Keep elbow + label text inside the SVG (ResponsiveContainer coordinate system). */
function fitElbowText(
  chartW: number,
  chartH: number,
  labelFontPx: number,
  maxTextReservePx: number,
  elbowIn: { x: number; y: number },
  sign: 1 | -1,
  textPad: number,
  pivotX: number,
): { elbow: { x: number; y: number }; lx: number; ly: number } {
  const { minY, maxY } = labelYBand(chartH, labelFontPx);
  const pad = Math.max(6, labelFontPx * 0.35);
  const minX = pad;
  const maxX = chartW - pad;
  const maxLx = maxX - maxTextReservePx;
  const minLx = minX + maxTextReservePx;

  const ey = Math.max(minY, Math.min(maxY, elbowIn.y));

  let ex: number;
  let lx: number;
  if (sign > 0) {
    ex = Math.max(elbowIn.x, pivotX);
    lx = ex + textPad;
    if (lx > maxLx) {
      lx = maxLx;
      ex = lx - textPad;
      if (ex < pivotX) {
        ex = pivotX;
        lx = ex + textPad;
      }
    }
  } else {
    ex = Math.min(elbowIn.x, pivotX);
    lx = ex - textPad;
    if (lx < minLx) {
      lx = minLx;
      ex = lx + textPad;
      if (ex > pivotX) {
        ex = pivotX;
        lx = ex - textPad;
      }
    }
  }

  const ly = Math.max(minY, Math.min(maxY, ey));
  return { elbow: { x: ex, y: ly }, lx, ly };
}

/** Enforce minimum vertical gap between adjacent label Y positions without stretching to fill the band. */
function packLabelsVertical(py: number[], minY: number, maxY: number, gap: number): number[] {
  const m = py.length;
  if (m === 0) return [];
  const y = py.map((p) => Math.max(minY, Math.min(maxY, p)));
  for (let iter = 0; iter < m + 4; iter++) {
    for (let i = 1; i < m; i++) {
      if (y[i]! < y[i - 1]! + gap) y[i] = y[i - 1]! + gap;
    }
    if (y[m - 1]! <= maxY) {
      for (let i = m - 2; i >= 0; i--) {
        if (y[i]! > y[i + 1]! - gap) y[i] = y[i + 1]! - gap;
      }
      break;
    }
    const overflow = y[m - 1]! - maxY;
    for (let i = 0; i < m; i++) y[i]! -= overflow;
    for (let i = m - 2; i >= 0; i--) {
      if (y[i]! > y[i + 1]! - gap) y[i] = y[i + 1]! - gap;
    }
    if (y[0]! >= minY) continue;
    const under = minY - y[0]!;
    for (let i = 0; i < m; i++) y[i]! += under;
  }
  return y;
}

/**
 * Per-side Y layout: keep labels near their slice (minimal shift), only separate when closer than `labelGapPx`.
 * Horizontal arm stagger is only added when packing compresses a side vertically (many labels, tight band).
 */
function computeLabelSpread(
  midAngles: number[],
  cx: number,
  cy: number,
  rKnee: number,
  minY: number,
  maxY: number,
  labelGapPx: number,
  staggerArmPx: number,
  labelEligible: boolean[],
): { yShift: number[]; extraArmPx: number[] } {
  const n = midAngles.length;
  const yShift = new Array(n).fill(0);
  const extraArmPx = new Array(n).fill(0);

  for (const side of [1, -1] as const) {
    const items = midAngles
      .map((mid, i) => ({
        i,
        mid,
        py: polarToCartesian(cx, cy, rKnee, mid).y,
      }))
      .filter((t) => labelEligible[t.i] && lateralSign(t.mid) === side)
      .sort((a, b) => a.py - b.py);

    const m = items.length;
    if (m === 0) continue;

    if (m === 1) {
      const t = items[0]!;
      const clamped = Math.max(minY, Math.min(maxY, t.py));
      yShift[t.i] = clamped - t.py;
      continue;
    }

    const pySorted = items.map((t) => t.py);
    const packed = packLabelsVertical(pySorted, minY, maxY, labelGapPx);
    items.forEach((t, rank) => {
      yShift[t.i] = packed[rank]! - t.py;
    });

    const naturalSpan = pySorted[m - 1]! - pySorted[0]!;
    const packedSpan = packed[m - 1]! - packed[0]!;
    const crowded = m >= 3;
    const compressed =
      naturalSpan > labelGapPx * 2 && packedSpan < naturalSpan * 0.85 && m >= 3;
    if (crowded) {
      items.forEach((t, rank) => {
        const tier = Math.floor(rank / 3);
        extraArmPx[t.i] = tier * staggerArmPx + (rank % 3) * Math.round(staggerArmPx * 0.45);
      });
    }
    if (compressed && m >= 5) {
      items.forEach((t, rank) => {
        extraArmPx[t.i] = Math.max(extraArmPx[t.i]!, Math.floor(rank / 2) * staggerArmPx);
      });
    }
  }

  return { yShift, extraArmPx };
}

export type PieSliceConstituent = { symbol: string; marketValue: number };

export type PieBucket = {
  label: string;
  totalMarketValue: number;
  byAsset: Array<{
    key: string;
    marketValue: number;
    weight: number;
    constituents?: PieSliceConstituent[];
  }>;
};

function useCompactPieLayout() {
  const [compact, setCompact] = useState(false);
  useEffect(() => {
    const mq = window.matchMedia("(max-width: 640px)");
    const apply = () => setCompact(mq.matches);
    apply();
    mq.addEventListener("change", apply);
    return () => mq.removeEventListener("change", apply);
  }, []);
  return compact;
}

/** Category labels on allocation bar chart Y-axis (keep pie callouts visually aligned). */
const ALLOCATION_BAR_MATCH_FONT_PX = 16;
const ALLOCATION_BAR_MATCH_FONT_WEIGHT = 800;

export function FinancePiePanel({
  title,
  buckets,
  emptyMessage,
  footer,
  symbolColorMap,
  /** `split`: denser margins, larger pie, labels match allocation bar Y-axis (size/weight/color). */
  layout = "default",
  /** When set with `labelStorageKey`, slice labels can be renamed and persist in localStorage (canonical key → display text). */
  allowLabelEdit = false,
  labelStorageKey,
  /** Slices whose constituents are shown as their own pie slices (parent page state). */
  expandedSliceKeys,
  /** Toggle expanded/breakout for a slice (e.g. sector → symbols). */
  onToggleSliceExpand,
  /** Show “Break out” in the tooltip when constituents exist. */
  enableSliceBreakout = false,
}: {
  title: string;
  buckets: PieBucket[];
  /** Shown when every slice is filtered out (e.g. all synthetic MV are zero). */
  emptyMessage?: string;
  /** Rendered below the chart inside the same card (e.g. scope controls). */
  footer?: ReactNode;
  symbolColorMap?: Map<string, string>;
  layout?: "default" | "split";
  allowLabelEdit?: boolean;
  labelStorageKey?: string;
  expandedSliceKeys?: readonly string[];
  onToggleSliceExpand?: (sliceKey: string) => void;
  enableSliceBreakout?: boolean;
}) {
  const privacy = usePrivacy();
  const router = useRouter();
  const compact = useCompactPieLayout();
  const split = layout === "split";
  const chartWrapRef = useRef<HTMLDivElement>(null);
  const [measuredChart, setMeasuredChart] = useState<{ w: number; h: number } | null>(null);
  const [labelOverrides, setLabelOverrides] = useState<Record<string, string>>({});
  const [editingSliceKey, setEditingSliceKey] = useState<string | null>(null);
  const [editingDraft, setEditingDraft] = useState("");

  const persistKey = allowLabelEdit && labelStorageKey ? labelStorageKey : null;

  useEffect(() => {
    if (!persistKey) {
      setLabelOverrides({});
      return;
    }
    setLabelOverrides(readLabelOverrides(persistKey));
  }, [persistKey]);

  const expandedSet = useMemo(
    () => new Set((expandedSliceKeys ?? []).map((k) => k.trim()).filter(Boolean)),
    [expandedSliceKeys],
  );

  useEffect(() => {
    if (!editingSliceKey) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setEditingSliceKey(null);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [editingSliceKey]);

  useEffect(() => {
    if (!editingSliceKey) {
      setEditingDraft("");
      return;
    }
    const k = editingSliceKey.trim();
    setEditingDraft(labelOverrides[k] ?? k);
  }, [editingSliceKey, labelOverrides]);

  const b = buckets[0];
  const rawAssets = b?.byAsset ?? [];
  const baseRows = rawAssets
    .filter((x) => x.marketValue > 0)
    .sort((a, b2) => b2.marketValue - a.marketValue || a.key.localeCompare(b2.key));

  const data = useMemo(() => {
    return baseRows.map((row) => {
      const k = (row.key ?? "").trim();
      const pieDisplayName = (labelOverrides[k] ?? k).trim() || k;
      return { ...row, pieDisplayName };
    });
  }, [baseRows, labelOverrides]);

  useLayoutEffect(() => {
    if (data.length === 0) return;
    const el = chartWrapRef.current;
    if (!el) return;
    const apply = (w: number, h: number) => {
      if (w > 0 && h > 0) setMeasuredChart({ w: Math.round(w), h: Math.round(h) });
    };
    apply(el.clientWidth, el.clientHeight);
    const ro = new ResizeObserver((entries) => {
      const cr = entries[0]?.contentRect;
      if (!cr) return;
      apply(cr.width, cr.height);
    });
    ro.observe(el);
    return () => ro.disconnect();
  }, [data.length, compact, split]);
  const total = b?.totalMarketValue ?? 0;

  const labelFontPx = split ? ALLOCATION_BAR_MATCH_FONT_PX : compact ? 11 : 24;
  const labelFontWeight = split ? ALLOCATION_BAR_MATCH_FONT_WEIGHT : 600;
  const textPad = split ? 8 : compact ? 6 : 10;
  /** Radial segment from slice rim to pivot — keep short unless packing forces horizontal stagger. */
  const radialToPivot = split ? 26 : compact ? 28 : 44;
  /** Horizontal arm from pivot toward label (baseline; stagger adds more only when vertically compressed). */
  const horizontalArm = split ? 30 : compact ? 28 : 44;
  /** Extra horizontal arm when many same-side labels are packed tighter than their natural angular spread. */
  const staggerArmPx = split ? 18 : compact ? 14 : 20;
  /** Reserve horizontal space for longest label + staggered arms (approximate). */
  const maxTextReservePx = split ? 260 : compact ? 120 : 340;

  const pieMargin = useMemo(
    () =>
      split
        ? { top: 32, right: 108, bottom: 32, left: 64 }
        : compact
          ? { top: 52, right: 76, bottom: 52, left: 76 }
          : { top: 58, right: 108, bottom: 58, left: 108 },
    [compact, split],
  );
  const innerR = split ? "30%" : compact ? "28%" : "34%";
  const outerR = split ? "78%" : compact ? "82%" : "72%";

  const midAngles = useMemo(() => approximateMidAngles(data.map((d) => d.marketValue), 0.5), [data]);
  const outerFrac = split ? 0.78 : compact ? 0.82 : 0.72;
  const defaultDims = split ? { w: 520, h: 400 } : compact ? { w: 360, h: 320 } : { w: 800, h: 420 };
  const chartW = measuredChart?.w ?? defaultDims.w;
  const chartH = measuredChart?.h ?? defaultDims.h;
  const { cx: estCx, cy: estCy, outerRadius: estOuterR } = useMemo(
    () => estimatePieLayout(chartW, chartH, pieMargin, outerFrac),
    [chartW, chartH, pieMargin, outerFrac],
  );
  const { minY: labelMinY, maxY: labelMaxY } = useMemo(() => labelYBand(chartH, labelFontPx), [chartH, labelFontPx]);
  const labelGapPx = split ? Math.max(18, labelFontPx * 1.5) : compact ? Math.max(14, labelFontPx * 1.25) : Math.max(16, labelFontPx * 1.35);
  /** Slices below this weight share skip callout labels (still in tooltip). */
  const minLabelPercent = split ? 0.0075 : compact ? 0.012 : 0.004;
  const labelEligible = useMemo(() => {
    if (total <= 0) return data.map(() => false);
    return data.map((d) => d.marketValue / total >= minLabelPercent);
  }, [data, total, minLabelPercent]);
  const { yShift: labelYShifts, extraArmPx } = useMemo(() => {
    const rKnee = estOuterR + radialToPivot;
    return computeLabelSpread(
      midAngles,
      estCx,
      estCy,
      rKnee,
      labelMinY,
      labelMaxY,
      labelGapPx,
      staggerArmPx,
      labelEligible,
    );
  }, [
    midAngles,
    estCx,
    estCy,
    estOuterR,
    radialToPivot,
    labelMinY,
    labelMaxY,
    labelGapPx,
    staggerArmPx,
    labelEligible,
  ]);

  return (
    <div
      className={
        split
          ? "flex h-full min-h-0 w-full min-w-0 flex-col bg-transparent"
          : "w-full min-w-0 rounded-xl border border-zinc-300 px-3 pb-3 pt-2.5 sm:px-4 sm:pb-3.5 sm:pt-3 dark:border-white/20"
      }
    >
      <div className={"flex flex-wrap items-center justify-between gap-2 sm:gap-3 " + (split ? "shrink-0 pb-1" : "")}>
        <div className={"min-w-0 font-semibold " + (split ? "text-xs text-zinc-800 dark:text-zinc-100" : "text-sm")}>
          {title}
        </div>
        <div
          className={
            "shrink-0 tabular-nums text-zinc-600 dark:text-zinc-400 " + (split ? "text-xs" : "text-sm")
          }
        >
          Total {formatUsd2(total, { mask: privacy.masked })}
        </div>
      </div>

      <div
        className={
          split
            ? "mt-1 min-h-0 flex-1 w-full min-w-0 overflow-visible"
            : "mt-2 w-full min-w-0 overflow-x-auto sm:mt-3 " + (compact ? "min-h-[18rem]" : "min-h-0")
        }
      >
        {data.length === 0 ? (
          <div className="flex h-full max-w-md flex-col items-center justify-center gap-2 px-4 py-12 text-center text-sm text-zinc-600 dark:text-zinc-400">
            <span>{emptyMessage ?? "No data yet."}</span>
          </div>
        ) : (
          <>
            <div
              ref={chartWrapRef}
              className={
                split
                  ? "h-full min-h-[clamp(220px,42vh,520px)] w-full flex-1 overflow-visible lg:min-h-[clamp(260px,50vh,560px)]"
                  : compact
                    ? "h-[min(22rem,70vh)] w-full min-h-[16rem] overflow-visible"
                    : "aspect-[16/11] h-auto min-h-[22rem] w-full max-h-[min(36rem,76dvh)] overflow-visible"
              }
            >
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={100}
                minHeight={split ? 220 : compact ? 240 : 360}
                initialDimension={{ width: split ? 520 : compact ? 360 : 800, height: split ? 400 : compact ? 320 : 420 }}
              >
                <PieChart margin={pieMargin}>
                  <Tooltip
                    content={({ active, payload }) => {
                      if (!active || !payload?.length) return null;
                      const row = payload[0]?.payload as {
                        key?: string;
                        pieDisplayName?: string;
                        marketValue?: number;
                        constituents?: PieSliceConstituent[];
                      };
                      const mv = Number(row.marketValue);
                      if (!Number.isFinite(mv)) return null;
                      const pct = total ? mv / total : 0;
                      const canonical = (row.key ?? "").trim();
                      const label = (row.pieDisplayName ?? row.key ?? "—").trim() || "—";
                      const list = row.constituents?.filter((c) => c.marketValue > 0) ?? [];
                      const canBreak =
                        enableSliceBreakout &&
                        typeof onToggleSliceExpand === "function" &&
                        list.length > 0 &&
                        !expandedSet.has(canonical);
                      const canCollapse =
                        enableSliceBreakout &&
                        typeof onToggleSliceExpand === "function" &&
                        expandedSet.has(canonical);
                      return (
                        <div className="max-w-xs rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm shadow-md dark:border-white/20 dark:bg-zinc-900">
                          <div className="font-semibold text-zinc-900 dark:text-zinc-100">{label}</div>
                          <div className="mt-0.5 tabular-nums text-zinc-700 dark:text-zinc-300">
                            {formatUsd2(mv, { mask: privacy.masked })} ({PCT2.format(pct * 100)}%)
                          </div>
                          {canBreak || canCollapse ? (
                            <div className="mt-2 border-t border-zinc-200 pt-2 dark:border-white/20">
                              <button
                                type="button"
                                className="w-full rounded-md border border-zinc-300 bg-zinc-50 px-2 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-100 dark:border-white/20 dark:bg-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-700"
                                onClick={(e) => {
                                  e.preventDefault();
                                  e.stopPropagation();
                                  onToggleSliceExpand?.(canonical);
                                }}
                              >
                                {canCollapse ? "Merge slice (collapse holdings)" : "Break out into holdings"}
                              </button>
                            </div>
                          ) : null}
                          {list.length ? (
                            <ul className="mt-2 max-h-52 space-y-1 overflow-y-auto border-t border-zinc-200 pt-2 text-xs dark:border-white/20">
                              {list.map((c) => (
                                <li key={c.symbol} className="flex justify-between gap-4 tabular-nums">
                                  <SymbolLink symbol={c.symbol} className="font-medium text-zinc-800 dark:text-zinc-200">
                                    {c.symbol}
                                  </SymbolLink>
                                  <span className="text-zinc-600 dark:text-zinc-400">
                                    {formatUsd2(c.marketValue, { mask: privacy.masked })}
                                  </span>
                                </li>
                              ))}
                            </ul>
                          ) : null}
                        </div>
                      );
                    }}
                  />
                  <Pie
                    data={data}
                    dataKey="marketValue"
                    nameKey="pieDisplayName"
                    stroke="none"
                    isAnimationActive={false}
                    innerRadius={innerR}
                    outerRadius={outerR}
                    paddingAngle={0.5}
                    labelLine={(
                      lineProps: SVGProps<SVGPathElement> & {
                        points?: Array<{ x: number; y: number }>;
                        cx?: number;
                        cy?: number;
                        outerRadius?: number;
                        midAngle?: number;
                        index?: number;
                      },
                    ) => {
                      const pts = lineProps.points;
                      const cx = Number(lineProps.cx);
                      const cy = Number(lineProps.cy);
                      const outerR = Number(lineProps.outerRadius);
                      const mid = lineProps.midAngle;
                      const idx = lineProps.index ?? 0;
                      const slicePct = total > 0 ? (data[idx]?.marketValue ?? 0) / total : 0;
                      if (
                        slicePct < minLabelPercent ||
                        !pts?.[0] ||
                        !Number.isFinite(cx) ||
                        !Number.isFinite(cy) ||
                        !Number.isFinite(outerR) ||
                        mid == null ||
                        !Number.isFinite(mid)
                      ) {
                        return <g />;
                      }
                      const p0 = pts[0];
                      const pivot = polarToCartesian(cx, cy, outerR + radialToPivot, mid);
                      const sign = lateralSign(mid);
                      const yShift = labelYShifts[idx] ?? 0;
                      const arm = horizontalArm + (extraArmPx[idx] ?? 0);
                      const elbowRaw = { x: pivot.x + sign * arm, y: pivot.y + yShift };
                      const { elbow } = fitElbowText(
                        chartW,
                        chartH,
                        labelFontPx,
                        maxTextReservePx,
                        elbowRaw,
                        sign,
                        textPad,
                        pivot.x,
                      );
                      const entryKey = (data[idx]?.key ?? "").trim();
                      const stroke =
                        symbolColorMap?.get(entryKey) ??
                        (typeof lineProps.stroke === "string" ? lineProps.stroke : "#71717a");
                      return (
                        <path
                          d={`M${p0.x},${p0.y}L${pivot.x},${pivot.y}L${elbow.x},${elbow.y}`}
                          fill="none"
                          stroke={stroke}
                          strokeWidth={1.5}
                          strokeLinejoin="round"
                          className="recharts-pie-label-line"
                        />
                      );
                    }}
                    label={(props: PieLabelRenderProps) => {
                      const p = typeof props.percent === "number" && Number.isFinite(props.percent) ? props.percent : 0;
                      if (p <= 0 || p < minLabelPercent) {
                        return null;
                      }
                      const { cx, cy, outerRadius, midAngle, name, index } = props;
                      const cxN = Number(cx);
                      const cyN = Number(cy);
                      const outerR = Number(outerRadius);
                      const mid = midAngle;
                      const idx = typeof index === "number" ? index : 0;
                      if (!Number.isFinite(cxN) || !Number.isFinite(cyN) || !Number.isFinite(outerR) || mid == null || !Number.isFinite(mid)) {
                        return null;
                      }
                      const sign = lateralSign(mid);
                      const yShift = labelYShifts[idx] ?? 0;
                      const pivot = polarToCartesian(cxN, cyN, outerR + radialToPivot, mid);
                      const arm = horizontalArm + (extraArmPx[idx] ?? 0);
                      const elbowRaw = { x: pivot.x + sign * arm, y: pivot.y + yShift };
                      const fit = fitElbowText(
                        chartW,
                        chartH,
                        labelFontPx,
                        maxTextReservePx,
                        elbowRaw,
                        sign,
                        textPad,
                        pivot.x,
                      );
                      const { lx, ly } = fit;
                      const anchor: "start" | "end" = sign > 0 ? "start" : "end";
                      const displayRaw = String(name ?? "").trim();
                      const canonicalKey = String(data[idx]?.key ?? "").trim();
                      const maxLen = split ? 36 : compact ? 12 : 22;
                      const short =
                        displayRaw.length > maxLen ? `${displayRaw.slice(0, maxLen - 1)}…` : displayRaw;
                      const sliceLabelColor = symbolColorMap?.get(canonicalKey);
                      const href = split ? symbolPageHref(canonicalKey) : null;
                      const beginEdit = () => {
                        if (!allowLabelEdit || !canonicalKey) return;
                        setEditingSliceKey(canonicalKey);
                      };
                      return (
                        <text
                          x={lx}
                          y={ly}
                          textAnchor={anchor}
                          dominantBaseline="central"
                          fill={sliceLabelColor ?? "currentColor"}
                          className={
                            split
                              ? sliceLabelColor
                                ? undefined
                                : "fill-zinc-900 dark:fill-zinc-100"
                              : "text-zinc-800 dark:text-zinc-200"
                          }
                          style={{
                            fontSize: labelFontPx,
                            fontWeight: labelFontWeight,
                            cursor:
                              href && allowLabelEdit
                                ? "pointer"
                                : href
                                  ? "pointer"
                                  : allowLabelEdit
                                    ? "text"
                                    : undefined,
                          }}
                          onClick={(e) => {
                            if (allowLabelEdit && !split) {
                              e.preventDefault();
                              beginEdit();
                              return;
                            }
                            if (href) {
                              e.preventDefault();
                              router.push(href);
                            }
                          }}
                          onDoubleClick={(e) => {
                            if (allowLabelEdit && split && canonicalKey) {
                              e.preventDefault();
                              e.stopPropagation();
                              beginEdit();
                            }
                          }}
                        >
                          {href ? (
                            <title>{allowLabelEdit ? "Open in Terminal (double-click label to rename)" : "Open in Terminal"}</title>
                          ) : allowLabelEdit ? (
                            <title>Click to rename label</title>
                          ) : null}
                          {split || !compact ? `${short} ${PCT2.format(p * 100)}%` : `${PCT2.format(p * 100)}%`}
                        </text>
                      );
                    }}
                  >
                    {data.map((entry, idx) => {
                      const k = (entry.key ?? "").trim();
                      const fill = symbolColorMap?.get(k) ?? distinctColorForIndex(idx);
                      return <Cell key={entry.key} fill={fill} />;
                    })}
                  </Pie>
                </PieChart>
              </ResponsiveContainer>
            </div>
          </>
        )}
      </div>
      {allowLabelEdit && editingSliceKey && persistKey ? (
        <div
          className={
            "mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-zinc-200 bg-zinc-50 px-3 py-2.5 dark:border-white/15 dark:bg-zinc-900/60 " +
            (split ? "shrink-0" : "")
          }
        >
          <div className="min-w-[10rem] flex-1">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-400" htmlFor="pie-label-edit-input">
              Display label ({editingSliceKey})
            </label>
            <input
              id="pie-label-edit-input"
              className="mt-1 w-full rounded-md border border-zinc-300 bg-white px-2 py-1.5 text-sm text-zinc-900 shadow-sm focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100"
              value={editingDraft}
              onChange={(e) => setEditingDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") {
                  e.preventDefault();
                  const k = editingSliceKey.trim();
                  const d = editingDraft.trim();
                  const next = { ...labelOverrides };
                  if (!d || d === k) delete next[k];
                  else next[k] = d;
                  setLabelOverrides(next);
                  writeLabelOverrides(persistKey, next);
                  setEditingSliceKey(null);
                }
              }}
              autoFocus
            />
          </div>
          <button
            type="button"
            className="rounded-md bg-zinc-900 px-3 py-1.5 text-xs font-semibold text-white hover:bg-zinc-800 dark:bg-white dark:text-zinc-900 dark:hover:bg-zinc-100"
            onClick={() => {
              const k = editingSliceKey.trim();
              const d = editingDraft.trim();
              const next = { ...labelOverrides };
              if (!d || d === k) delete next[k];
              else next[k] = d;
              setLabelOverrides(next);
              writeLabelOverrides(persistKey, next);
              setEditingSliceKey(null);
            }}
          >
            Save
          </button>
          <button
            type="button"
            className="rounded-md border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
            onClick={() => setEditingSliceKey(null)}
          >
            Cancel
          </button>
        </div>
      ) : null}
      {footer ? (
        <div className={"border-t border-zinc-200 pt-3 dark:border-white/15 " + (split ? "mt-2 shrink-0" : "mt-3")}>
          {footer}
        </div>
      ) : null}
    </div>
  );
}
