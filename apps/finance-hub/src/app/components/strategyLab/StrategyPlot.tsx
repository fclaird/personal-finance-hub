"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent, type ReactElement, type ReactNode } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Line,
  ReferenceArea,
  ReferenceDot,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatSignedUsd2 } from "@/lib/format";
import {
  crossoverCallouts,
  isPlottableStructure,
  samplePnl,
  shortHorizon,
  stockHorizonId,
  type ChartChrome,
  type CurveView,
} from "@/lib/strategyLab/chartDisplay";
import {
  boxZoomView,
  clampView,
  panView,
  ySpanForX,
  zoomAroundCursor,
  type ChartPoint,
  type ChartView,
} from "@/lib/strategyLab/chartView";
import { capitalExpiryPnl, type ExpiryBoard, type ExpiryZone, type LabEvaluation, type PricedStructure } from "@/lib/strategyLab/lab";
import { LAB_PALETTE, seriesColor } from "@/lib/strategyLab/palette";

export type ChartRow = { spot: number; stock?: number } & Record<string, number | undefined>;

export type PlotYLine = { readonly key: string; readonly y: number; readonly label: string };
export type PlotXLine = { readonly key: string; readonly x: number; readonly label: string; readonly color?: string };

const CHART_HEIGHT = "h-[75vh] min-h-[42rem]";

type PlotDrag = {
  kind: "hand" | "box";
  pointerId: number;
  startX: number;
  startY: number;
  origin: ChartView;
  grid: DOMRect;
  plot: DOMRect;
};

function money(n: number | undefined | null, mask: boolean): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatSignedUsd2(n, { mask });
}

function spotText(n: number): string {
  return String(Math.round(n * 100) / 100);
}

/** 1/2/5 × 10^n ticks that bracket the data. */
export function niceAxis(lo: number, hi: number, target = 6): { domain: [number, number]; ticks: number[] } {
  if (!(hi > lo) || !Number.isFinite(lo) || !Number.isFinite(hi)) {
    return { domain: [lo - 1, hi + 1], ticks: [lo - 1, 0, hi + 1] };
  }
  const rough = (hi - lo) / target;
  const pow = 10 ** Math.floor(Math.log10(Math.max(rough, 1e-9)));
  const err = rough / pow;
  const mult = err <= 1 ? 1 : err <= 2 ? 2 : err <= 5 ? 5 : 10;
  const step = mult * pow;
  const start = Math.floor(lo / step) * step;
  const end = Math.ceil(hi / step) * step;
  const count = Math.max(1, Math.round((end - start) / step));
  const ticks: number[] = [];
  for (let i = 0; i <= count; i++) ticks.push(Math.round((start + i * step) * 1e8) / 1e8);
  return { domain: [ticks[0]!, ticks[ticks.length - 1]!], ticks };
}

function ChartTip({
  active,
  payload,
  mask,
  structures,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: ChartRow }>;
  mask: boolean;
  structures: readonly PricedStructure[];
}) {
  if (!active || !payload?.length) return null;
  const spot = payload[0]?.payload?.spot;
  const rows = [...payload].sort((a, b) => {
    const left = typeof a.value === "number" && Number.isFinite(a.value) ? a.value : Number.NEGATIVE_INFINITY;
    const right = typeof b.value === "number" && Number.isFinite(b.value) ? b.value : Number.NEGATIVE_INFINITY;
    return right - left;
  });
  return (
    <div className="max-w-xs rounded-md border border-zinc-500 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 shadow-lg">
      <div className="tabular-nums text-zinc-50">Spot {spot != null ? spot.toFixed(2) : ""}</div>
      {rows.map((item) => (
        <div key={String(item.name)} className="tabular-nums" style={{ color: item.color }}>
          {item.name} {money(typeof item.value === "number" ? item.value : undefined, mask)}
        </div>
      ))}
      {spot != null ? (
        <div className="mt-1 border-t border-zinc-600 pt-1">
          <div className="text-zinc-300">At expiry</div>
          {structures.map((row) => (
            <div key={row.spec.id} className="tabular-nums" style={{ color: seriesColor(row.spec.slot) }}>
              {row.spec.label} {money(capitalExpiryPnl(row, spot), mask)}
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

function Swatch({ color, width, dash }: { color: string; width: number; dash?: string }) {
  return (
    <svg width="28" height="10" aria-hidden className="shrink-0">
      <line x1="0" y1="5" x2="28" y2="5" stroke={color} strokeWidth={Math.min(width, 4)} strokeDasharray={dash} strokeLinecap="round" />
    </svg>
  );
}

function NavButton({ label, pressed, onClick }: { label: string; pressed?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      aria-label={label}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        pressed ? "bg-zinc-100 text-zinc-950" : "border border-zinc-500 text-zinc-100 hover:border-zinc-200"
      }`}
    >
      {label}
    </button>
  );
}

export function StrategyPlot({
  title,
  metric,
  subtitle,
  evaluation,
  priced,
  curves,
  chrome,
  masked,
  whatIfSpot,
  view,
  onView,
  onHome,
  focusedKey,
  onFocus,
  useLook,
  rows: rowsOverride,
  formatY,
  tooltip,
  stepKeys,
  yLines = [],
  xLines = [],
  header,
  footer,
  annotate = true,
  forceStrikes = false,
  stockName,
  role = "pnl",
}: {
  title: string;
  metric: string;
  subtitle?: string;
  evaluation: LabEvaluation;
  priced: readonly PricedStructure[];
  curves: readonly CurveView[];
  chrome: ChartChrome;
  masked: boolean;
  whatIfSpot: number | null;
  view: ChartView | null;
  onView: (next: ChartView | null) => void;
  onHome: (next: ChartView) => void;
  focusedKey: string | null;
  onFocus: (key: string | null) => void;
  useLook: boolean;
  rows?: readonly ChartRow[];
  formatY?: (value: number) => string;
  tooltip?: ReactElement;
  stepKeys?: ReadonlySet<string>;
  yLines?: readonly PlotYLine[];
  xLines?: readonly PlotXLine[];
  header?: ReactNode;
  footer?: ReactNode;
  annotate?: boolean;
  forceStrikes?: boolean;
  stockName?: string;
  role?: "pnl" | "delta";
}) {
  const rows = useMemo(
    () => rowsOverride ?? buildChartRows(evaluation, curves, chrome.showStock),
    [rowsOverride, evaluation, curves, chrome.showStock],
  );
  const frame = useMemo(
    () => chartFrame(rows, curves, evaluation.spotWindow, chrome.yAxis),
    [rows, curves, evaluation.spotWindow, chrome.yAxis],
  );
  useEffect(() => {
    onHome(frame.home);
  }, [frame.home, onHome]);

  const shown = view ?? frame.home;
  const shownRef = useRef(shown);
  const limitsRef = useRef(frame.limits);
  const onViewRef = useRef(onView);
  useLayoutEffect(() => {
    shownRef.current = shown;
    limitsRef.current = frame.limits;
    onViewRef.current = onView;
  }, [shown, frame.limits, onView]);
  const plotRef = useRef<HTMLDivElement>(null);
  const dragRef = useRef<PlotDrag | null>(null);
  const [tool, setTool] = useState<"hand" | "box">("hand");
  const [dragging, setDragging] = useState(false);
  const [box, setBox] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  const plotReady = rows.length > 0 && curves.length > 0;

  useEffect(() => {
    const node = plotRef.current;
    if (!node) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const geometry = plotGeometry(node);
      const current = shownRef.current;
      if (!geometry || !current) return;
      const cursor = pointToData(event.clientX, event.clientY, geometry.grid, current);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1;
      const factor = Math.exp(-event.deltaY * unit * 0.0012);
      const next = zoomAroundCursor(current, cursor, factor, limitsRef.current);
      shownRef.current = next;
      onViewRef.current(next);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [plotReady]);

  const readoutSpot = whatIfSpot ?? evaluation.spot;
  const marked = priced.filter((row) => curves.some((curve) => curve.structureId === row.spec.id));
  const callouts = (
    annotate && chrome.showCrossovers ? crossoverCallouts(evaluation, curves, { min: shown.xMin, max: shown.xMax }) : []
  ).filter((callout) => {
    const y = calloutY(priced, curves, callout.horizonId, callout.structureId, callout.spot);
    return y != null && y >= shown.yMin && y <= shown.yMax;
  });
  const zones = annotate && chrome.showZones ? zoneBands(evaluation, curves, shown.xMin, shown.xMax) : [];
  const inX = (spot: number) => spot >= shown.xMin - 1e-8 && spot <= shown.xMax + 1e-8;
  const inY = (y: number) => y >= shown.yMin - 1e-6 && y <= shown.yMax + 1e-6;
  const strikeSpots =
    chrome.showStrikes || forceStrikes
      ? [...new Set(marked.flatMap((row) => row.legs.map((leg) => leg.strike)))].filter(inX).sort((a, b) => a - b)
      : [];
  const breakevens =
    annotate && chrome.showBreakevens
      ? marked.flatMap((row) => row.risk.breakevens.filter(inX).map((spot) => ({ spot, id: row.spec.id, color: seriesColor(row.spec.slot) })))
      : [];
  const builtIn = rowsOverride == null;
  const stockId = builtIn && chrome.showStock ? stockHorizonId(evaluation, curves) : null;
  const stock = stockId ? evaluation.stock.find((series) => series.horizonId === stockId) : undefined;
  const showStockLine = builtIn ? Boolean(stock) : rows.some((row) => typeof row.stock === "number");
  const stockLabel =
    stockName ?? (stockId ? `Stock · ${shortHorizon(evaluation.horizons.find((horizon) => horizon.id === stockId)?.label ?? "Stock")}` : "Stock");
  const yTicks = niceAxis(shown.yMin, shown.yMax).ticks.filter((tick) => tick >= shown.yMin - 1e-6 && tick <= shown.yMax + 1e-6);
  const formatTick = (value: number) => (formatY ? formatY(value) : masked ? "XXXXX" : formatSignedUsd2(value));

  const zoomBy = (factor: number) => {
    const cursor = { x: (shown.xMin + shown.xMax) / 2, y: (shown.yMin + shown.yMax) / 2 };
    onView(zoomAroundCursor(shown, cursor, factor, frame.limits));
  };

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return;
    const node = plotRef.current;
    const geometry = node ? plotGeometry(node) : null;
    if (!geometry) return;
    node?.setPointerCapture(event.pointerId);
    dragRef.current = {
      kind: tool,
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      origin: shown,
      grid: geometry.grid,
      plot: geometry.plot,
    };
    setDragging(true);
    if (tool === "box") setBox({ left: event.clientX - geometry.plot.left, top: event.clientY - geometry.plot.top, width: 0, height: 0 });
  };

  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (drag.kind === "hand") {
      const dxPx = event.clientX - drag.startX;
      const dyPx = event.clientY - drag.startY;
      if (Math.hypot(dxPx, dyPx) < 3) return;
      const dx = -(dxPx / drag.grid.width) * (drag.origin.xMax - drag.origin.xMin);
      const dy = (dyPx / drag.grid.height) * (drag.origin.yMax - drag.origin.yMin);
      onView(panView(drag.origin, dx, dy, limitsRef.current));
      return;
    }
    setBox({
      left: Math.min(event.clientX, drag.startX) - drag.plot.left,
      top: Math.min(event.clientY, drag.startY) - drag.plot.top,
      width: Math.abs(event.clientX - drag.startX),
      height: Math.abs(event.clientY - drag.startY),
    });
  };

  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
    setBox(null);
    if (drag.kind !== "box") return;
    const width = Math.abs(event.clientX - drag.startX);
    const height = Math.abs(event.clientY - drag.startY);
    if (width < 8 || height < 8) return;
    const next = boxZoomView(
      pointToData(drag.startX, drag.startY, drag.grid, drag.origin),
      pointToData(event.clientX, event.clientY, drag.grid, drag.origin),
      limitsRef.current,
    );
    if (next) onView(next);
  };

  if (!plotReady) {
    return (
      <section className="rounded-xl border border-zinc-600 bg-zinc-950 p-3 text-sm text-zinc-300" data-chart-role={role}>
        {title ? <p className="text-base font-semibold text-zinc-100">{title}</p> : null}
        <p className="mt-2">Nothing to draw until a package fits and a date is on.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-600 bg-zinc-950 p-3 text-zinc-100" data-chart-layout="single" data-chart-role={role} aria-label={title}>
      <div className="mb-2 flex flex-wrap items-center gap-1.5" role="toolbar" aria-label="Chart navigation">
        <NavButton label="Hand" pressed={tool === "hand"} onClick={() => setTool("hand")} />
        <NavButton label="Box zoom" pressed={tool === "box"} onClick={() => setTool("box")} />
        <NavButton label="Zoom in" onClick={() => zoomBy(1.25)} />
        <NavButton label="Zoom out" onClick={() => zoomBy(0.8)} />
        <NavButton label="Reset view" onClick={() => onView(null)} />
        <span className="text-xs tabular-nums text-zinc-300">
          Visible price {spotText(shown.xMin)}–{spotText(shown.xMax)}
        </span>
      </div>
      {title ? <p className="mb-1 text-base font-semibold text-zinc-100">{title}</p> : null}
      {metric ? <p className="mb-2 text-sm text-zinc-300">{metric}</p> : null}
      {subtitle ? <p className="mb-2 text-xs text-zinc-300">{subtitle}</p> : null}
      {header ? <div className="mb-2">{header}</div> : null}
      <div
        ref={plotRef}
        className={`relative ${CHART_HEIGHT} w-full select-none overscroll-contain ${
          tool === "box" ? "cursor-crosshair" : dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={rows as ChartRow[]} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
            <CartesianGrid strokeDasharray="3 3" stroke={LAB_PALETTE.grid} />
            <XAxis
              dataKey="spot"
              type="number"
              domain={[shown.xMin, shown.xMax]}
              tickFormatter={(value: number) => value.toFixed(0)}
              allowDataOverflow
              tick={{ fill: LAB_PALETTE.axis, fontSize: 13 }}
              axisLine={{ stroke: LAB_PALETTE.axisLine }}
              tickLine={{ stroke: LAB_PALETTE.axisLine }}
            />
            <YAxis
              domain={[shown.yMin, shown.yMax]}
              ticks={yTicks.length > 1 ? yTicks : undefined}
              tickFormatter={formatTick}
              width={formatY ? 108 : 96}
              allowDataOverflow
              tick={{ fill: LAB_PALETTE.axis, fontSize: 13 }}
              axisLine={{ stroke: LAB_PALETTE.axisLine }}
              tickLine={{ stroke: LAB_PALETTE.axisLine }}
            />
            <Tooltip
              content={tooltip ?? <ChartTip mask={masked} structures={marked} />}
              cursor={{ stroke: LAB_PALETTE.spot, strokeWidth: 1.5 }}
            />
            {zones.map((zone) => (
              <ReferenceArea key={zone.key} x1={zone.x1} x2={zone.x2} fill={zone.color} fillOpacity={LAB_PALETTE.zoneOpacity} strokeOpacity={0} />
            ))}
            {strikeSpots.map((strike) => (
              <ReferenceLine key={strike} x={strike} stroke={LAB_PALETTE.strike} strokeWidth={1} strokeDasharray="3 3" />
            ))}
            {xLines.filter((line) => inX(line.x)).map((line, index) => (
              <ReferenceLine
                key={line.key}
                x={line.x}
                stroke={line.color ?? LAB_PALETTE.axis}
                strokeWidth={1.5}
                strokeDasharray="2 3"
                label={{
                  value: line.label,
                  fill: line.color ?? LAB_PALETTE.axis,
                  fontSize: 11,
                  position: (["insideTopLeft", "insideBottomLeft", "insideTopRight"] as const)[index % 3],
                }}
              />
            ))}
            {callouts.map((callout) => {
              const y = calloutY(priced, curves, callout.horizonId, callout.structureId, callout.spot);
              if (y == null) return null;
              const color = curves.find((curve) => curve.structureId === callout.structureId && curve.horizonId === callout.horizonId)?.color ?? LAB_PALETTE.axis;
              return (
                <ReferenceDot
                  key={`${callout.horizonId}-${callout.n}`}
                  x={callout.spot}
                  y={y}
                  r={10}
                  fill={color}
                  stroke={LAB_PALETTE.dotStroke}
                  strokeWidth={1.5}
                  label={{ value: String(callout.n), position: "center", fill: "#09090b", fontSize: 11, fontWeight: 700 }}
                />
              );
            })}
            {breakevens.map((mark) => (
              <ReferenceDot key={`${mark.id}-${mark.spot}`} x={mark.spot} y={0} r={4} fill={mark.color} stroke={LAB_PALETTE.dotStroke} strokeWidth={1} />
            ))}
            <ReferenceLine y={0} stroke={LAB_PALETTE.zero} strokeWidth={1.5} />
            {yLines.filter((line) => inY(line.y)).map((line) => (
              <ReferenceLine
                key={line.key}
                y={line.y}
                stroke={LAB_PALETTE.axis}
                strokeWidth={1.25}
                strokeDasharray="1 4"
                label={{ value: line.label, fill: LAB_PALETTE.axis, fontSize: 11, position: "insideTopRight" }}
              />
            ))}
            {inX(evaluation.spot) ? (
              <ReferenceLine
                x={evaluation.spot}
                stroke={LAB_PALETTE.spot}
                strokeWidth={2}
                strokeDasharray="5 5"
                label={{ value: "Spot", fill: LAB_PALETTE.spot, fontSize: 12, position: "insideTopRight" }}
              />
            ) : null}
            {whatIfSpot != null && Math.abs(whatIfSpot - evaluation.spot) > 0.05 && inX(whatIfSpot) ? (
              <ReferenceLine
                x={whatIfSpot}
                stroke={LAB_PALETTE.whatIf}
                strokeWidth={2}
                strokeDasharray="2 2"
                label={{ value: "What-if", fill: LAB_PALETTE.whatIf, fontSize: 12, position: "insideBottomRight" }}
              />
            ) : null}
            {curves.map((curve) => (
              <Line
                key={curve.key}
                type={stepKeys?.has(curve.key) ? "stepAfter" : "linear"}
                dataKey={curve.key}
                name={curve.name}
                stroke={curve.color}
                strokeDasharray={curve.dash}
                strokeOpacity={!useLook || focusedKey == null || focusedKey === curve.key ? 1 : chrome.dimOpacity}
                dot={false}
                strokeWidth={curve.width}
                isAnimationActive={false}
                connectNulls={false}
              />
            ))}
            {showStockLine ? (
              <Line
                type="linear"
                dataKey="stock"
                name={stockLabel}
                stroke={LAB_PALETTE.stock}
                strokeDasharray="6 4"
                dot={false}
                strokeWidth={LAB_PALETTE.stockLine}
                isAnimationActive={false}
                connectNulls={false}
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
        {box && box.width > 0 && box.height > 0 ? (
          <div
            className="pointer-events-none absolute z-20 border border-zinc-100 bg-zinc-100/15"
            style={{ left: box.left, top: box.top, width: box.width, height: box.height }}
          />
        ) : null}
      </div>
      <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
        {curves.map((curve) => {
          const focused = focusedKey === curve.key;
          const dimmed = useLook && focusedKey != null && !focused;
          return (
            <button
              key={curve.key}
              type="button"
              aria-pressed={focused}
              onClick={() => onFocus(focused ? null : curve.key)}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-100"
              style={{ opacity: dimmed ? chrome.dimOpacity : 1 }}
            >
              <Swatch color={curve.color} width={curve.width} dash={curve.dash} />
              {curve.name}
            </button>
          );
        })}
        {showStockLine ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
            <Swatch color={LAB_PALETTE.stock} width={LAB_PALETTE.stockLine} dash="6 4" />
            Stock
          </span>
        ) : null}
      </div>
      {annotate && chrome.showCrossovers ? (
        <ol className="mt-3 flex list-none flex-wrap gap-x-4 gap-y-2" aria-label="Crossover legend">
          {callouts.length === 0 ? (
            <li className="text-xs text-zinc-300">No crossovers on the curves in view.</li>
          ) : (
            callouts.map((callout) => {
              const color =
                curves.find((curve) => curve.structureId === callout.structureId && curve.horizonId === callout.horizonId)?.color ??
                LAB_PALETTE.axis;
              return (
                <li key={`${callout.horizonId}-${callout.n}`} className="flex max-w-xl items-start gap-2 text-sm text-zinc-100">
                  <span
                    className="mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[11px] font-bold text-zinc-950"
                    style={{ backgroundColor: color }}
                  >
                    {callout.n}
                  </span>
                  <span>{callout.text}</span>
                </li>
              );
            })
          )}
        </ol>
      ) : null}
      {footer}
      {annotate && footer == null ? (
        <div className="mt-3 border-t border-zinc-700 pt-2">
          <p className="text-xs font-semibold text-zinc-300">At expiry if spot is {readoutSpot.toFixed(2)}</p>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
            {marked.map((row) => (
              <span key={row.spec.id} className="text-sm font-semibold tabular-nums" style={{ color: seriesColor(row.spec.slot) }}>
                {row.spec.label} {money(capitalExpiryPnl(row, readoutSpot), masked)}
              </span>
            ))}
          </div>
        </div>
      ) : null}
    </section>
  );
}

function buildChartRows(evaluation: LabEvaluation, curves: readonly CurveView[], showStock: boolean): ChartRow[] {
  const priced = evaluation.structures.filter(isPlottableStructure);
  const spots = evaluation.axis.length > 0 ? evaluation.axis : (priced[0]?.curves[0]?.points.map((point) => point.spot) ?? []);
  const stockId = showStock ? stockHorizonId(evaluation, curves) : null;
  const stock = stockId ? evaluation.stock.find((series) => series.horizonId === stockId) : undefined;
  return spots.map((spot) => {
    const row: ChartRow = { spot };
    for (const curve of curves) {
      const points = priced
        .find((item) => item.spec.id === curve.structureId)
        ?.curves.find((item) => item.horizonId === curve.horizonId)?.points;
      const pnl = points ? samplePnl(points, spot) : null;
      if (pnl != null) row[curve.key] = pnl;
    }
    if (stock) {
      const pnl = samplePnl(stock.points, spot);
      if (pnl != null) row.stock = pnl;
    }
    return row;
  });
}

function chartFrame(
  rows: readonly ChartRow[],
  curves: readonly CurveView[],
  spotWindow: { min: number; max: number },
  yAxis: ChartChrome["yAxis"],
): { limits: ChartView; home: ChartView } {
  const xs = rows.map((row) => row.spot);
  let xMin = xs.length > 0 ? Math.min(...xs) : spotWindow.min;
  let xMax = xs.length > 0 ? Math.max(...xs) : spotWindow.max;
  if (!(xMax > xMin)) {
    xMin -= 1;
    xMax += 1;
  }
  const samples: ChartPoint[] = [];
  for (const row of rows) {
    for (const curve of curves) {
      const value = row[curve.key];
      if (typeof value === "number") samples.push({ x: row.spot, y: value });
    }
    if (typeof row.stock === "number") samples.push({ x: row.spot, y: row.stock });
  }
  const dataY = padSpan(
    samples.map((sample) => sample.y),
    0.08,
  );
  const windowY = yAxis.kind === "manual" ? { min: yAxis.min, max: yAxis.max } : (ySpanForX(samples, spotWindow.min, spotWindow.max) ?? dataY);
  let yMin = Math.min(dataY.min, windowY.min);
  let yMax = Math.max(dataY.max, windowY.max);
  if (!(yMax > yMin)) {
    yMin -= 1;
    yMax += 1;
  }
  const limits: ChartView = { xMin, xMax, yMin, yMax };
  return {
    limits,
    home: clampView(
      {
        xMin: spotWindow.min,
        xMax: Math.max(spotWindow.max, spotWindow.min + 1e-6),
        yMin: windowY.min,
        yMax: Math.max(windowY.max, windowY.min + 1e-6),
      },
      limits,
    ),
  };
}

function padSpan(values: readonly number[], ratio: number): { min: number; max: number } {
  if (values.length === 0) return { min: -1, max: 1 };
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * ratio, 1);
  return { min: lo - pad, max: hi + pad };
}

function plotGeometry(root: HTMLElement): { grid: DOMRect; plot: DOMRect } | null {
  const plot = root.getBoundingClientRect();
  if (plot.width < 2 || plot.height < 2) return null;
  const grid = root.querySelector(".recharts-cartesian-grid")?.getBoundingClientRect() ?? plot;
  if (grid.width < 2 || grid.height < 2) return null;
  return { grid, plot };
}

function pointToData(clientX: number, clientY: number, grid: DOMRect, view: ChartView): ChartPoint {
  const x = Math.min(Math.max(clientX, grid.left), grid.right);
  const y = Math.min(Math.max(clientY, grid.top), grid.bottom);
  return {
    x: view.xMin + ((x - grid.left) / grid.width) * (view.xMax - view.xMin),
    y: view.yMax - ((y - grid.top) / grid.height) * (view.yMax - view.yMin),
  };
}

function calloutY(
  priced: readonly PricedStructure[],
  curves: readonly CurveView[],
  horizonId: string,
  structureId: string,
  spot: number,
): number | null {
  if (!curves.some((curve) => curve.structureId === structureId && curve.horizonId === horizonId)) return null;
  const points = priced.find((row) => row.spec.id === structureId)?.curves.find((curve) => curve.horizonId === horizonId)?.points;
  return points ? samplePnl(points, spot) : null;
}

function zoneBands(
  evaluation: LabEvaluation,
  curves: readonly CurveView[],
  xLo: number,
  xHi: number,
): { key: string; x1: number; x2: number; color: string }[] {
  const byHorizon = new Map<string, Set<string>>();
  for (const curve of curves) {
    const ids = byHorizon.get(curve.horizonId) ?? new Set<string>();
    ids.add(curve.structureId);
    byHorizon.set(curve.horizonId, ids);
  }
  const bands: { key: string; x1: number; x2: number; color: string }[] = [];
  for (const [horizonId, ids] of byHorizon) {
    const horizon = evaluation.horizons.find((item) => item.id === horizonId);
    if (!horizon?.settlement || ids.size < 2) continue;
    const board = boardForVisible(evaluation, ids);
    if (!board) continue;
    board.zones.forEach((zone, index) => {
      const x1 = Math.max(zone.lo, xLo);
      const x2 = Math.min(zone.hi ?? xHi, xHi);
      if (!(x2 > x1)) return;
      bands.push({ key: `${horizonId}-${index}`, x1, x2, color: zoneColor(evaluation, zone) });
    });
  }
  return bands;
}

function boardForVisible(evaluation: LabEvaluation, ids: ReadonlySet<string>): ExpiryBoard | null {
  return (
    evaluation.expiryBoards.find((board) => {
      const options = board.structureIds.filter((id) => id !== "stock");
      return board.exact && options.length >= 2 && options.every((id) => ids.has(id));
    }) ?? null
  );
}

function zoneColor(evaluation: LabEvaluation, zone: ExpiryZone): string {
  if (zone.bestId === "stock") return LAB_PALETTE.stock;
  const row = evaluation.structures.find((item) => item.spec.id === zone.bestId);
  return seriesColor(row?.spec.slot ?? 0);
}
