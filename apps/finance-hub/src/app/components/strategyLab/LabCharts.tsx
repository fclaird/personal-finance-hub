"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
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
  applyHorizonPolicy,
  CHART_MODES,
  applyCurveLook,
  combinedDateCurves,
  crossoverCallouts,
  defaultChartChrome,
  everyNthHorizonIds,
  expiryPlusOneIds,
  isPlottableStructure,
  initialChartSelection,
  policyFromIds,
  readChartSettings,
  reconcileChartSelection,
  samplePnl,
  setChartMode,
  setFocusHorizon,
  setHorizons,
  setStructures,
  shortHorizon,
  stockHorizonId,
  toggleHorizon,
  toggleStructure,
  visibleCurves,
  writeChartSettings,
  type ChartChrome,
  type ChartMode,
  type ChartSelection,
  type CurveView,
  type HorizonPolicy,
} from "@/lib/strategyLab/chartDisplay";
import {
  capitalExpiryPnl,
  packageCostOf,
  zeroPackageNotice,
  type ExpiryBoard,
  type ExpiryZone,
  type LabEdit,
  type LabEvaluation,
  type PricedStructure,
} from "@/lib/strategyLab/lab";
import {
  boxZoomView,
  clampView,
  panView,
  sameView,
  ySpanForX,
  zoomAroundCursor,
  type ChartPoint,
  type ChartView,
} from "@/lib/strategyLab/chartView";
import { LAB_PALETTE, labControl, labLabel } from "@/lib/strategyLab/palette";

type Row = { spot: number; stock?: number } & Record<string, number | undefined>;

const MODE_HINT: Record<ChartMode, string> = {
  structure: "Every selected structure on the date you pick, on one large chart. Drag to pan, scroll or pinch to zoom.",
  waterfall: "Every quarter for the rainbow structure, today through a thick expiry line. Other structures are one dashed expiry line.",
  quarters: "Only the dates you turn on.",
  expiry: "Settlement P&L only.",
  today: "Mark to market on the trade date.",
  span: "Today, one date you pick, and expiry.",
  dateOverlay: "Every selected structure on one date.",
  custom: "Any dates and any structures. Changes apply on this chart only.",
};

function money(n: number | undefined | null, mask: boolean): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatSignedUsd2(n, { mask });
}

function seriesColor(slot: number): string {
  return LAB_PALETTE.series[slot] ?? LAB_PALETTE.series[0];
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

function pricedOf(evaluation: LabEvaluation): PricedStructure[] {
  return evaluation.structures.filter(isPlottableStructure);
}

function ChartTip({
  active,
  payload,
  mask,
  structures,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: Row }>;
  mask: boolean;
  structures: readonly PricedStructure[];
}) {
  if (!active || !payload?.length) return null;
  const spot = payload[0]?.payload?.spot;
  return (
    <div className="max-w-xs rounded-md border border-zinc-500 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 shadow-lg">
      <div className="tabular-nums text-zinc-50">Spot {spot != null ? spot.toFixed(2) : ""}</div>
      {payload.map((item) => (
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

export function LabCharts({
  evaluation,
  masked,
  whatIfSpot,
  onEdit,
}: {
  evaluation: LabEvaluation;
  masked: boolean;
  whatIfSpot: number | null;
  onEdit: (edit: LabEdit) => void;
}) {
  const priced = pricedOf(evaluation);
  const [selection, setSelection] = useState<ChartSelection>(() => initialChartSelection(evaluation));
  const [chrome, setChrome] = useState<ChartChrome>(() => defaultChartChrome());
  const [minDraft, setMinDraft] = useState<string | null>(null);
  const [maxDraft, setMaxDraft] = useState<string | null>(null);
  const [yMinDraft, setYMinDraft] = useState<string | null>(null);
  const [view, setView] = useState<ChartView | null>(null);
  const [home, setHome] = useState<ChartView | null>(null);
  const [yMaxDraft, setYMaxDraft] = useState<string | null>(null);
  const hydrated = useRef(false);
  const knownStructures = useRef<string[] | null>(null);
  const knownHorizons = useRef<string[] | null>(null);
  const liveStructures = priced.map((row) => row.spec.id);
  const liveHorizons = evaluation.horizons.map((horizon) => horizon.id);
  const structureKey = liveStructures.join("\n");
  const horizonKey = liveHorizons.join("\n");

  useEffect(() => {
    const structures = structureKey ? structureKey.split("\n") : [];
    const horizons = horizonKey ? horizonKey.split("\n") : [];
    const prevStructures = knownStructures.current;
    const prevHorizons = knownHorizons.current;
    knownStructures.current = structures;
    knownHorizons.current = horizons;
    if (prevStructures == null || prevHorizons == null) return;
    setSelection((prev) => {
      const next = reconcileChartSelection(prev, { structures, horizons }, { structures: prevStructures, horizons: prevHorizons });
      if (prev.horizonPolicy.kind === "picked") return next;
      return { ...next, horizonIds: applyHorizonPolicy(evaluation.horizons, prev.horizonPolicy, next.focusHorizonId) };
    });
    // evaluation is the render that produced structureKey / horizonKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [structureKey, horizonKey]);

  useEffect(() => {
    const stored = readChartSettings(window.localStorage);
    hydrated.current = true;
    if (!stored) return;
    // One-time read of localStorage after mount. The server render cannot see it.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setChrome(stored.chrome);
    setSelection((prev) => ({
      ...prev,
      mode: stored.mode,
      horizonPolicy: stored.horizonPolicy,
      horizonIds: applyHorizonPolicy(evaluation.horizons, stored.horizonPolicy, prev.focusHorizonId),
    }));
    if (stored.chrome.showStock !== evaluation.stock.length > 0) {
      onEdit({ kind: "setShowStock", show: stored.chrome.showStock });
    }
    // Hydrate once. Later edits write through persist().
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const persist = (nextSelection: ChartSelection, nextChrome: ChartChrome) => {
    if (!hydrated.current) return;
    writeChartSettings(window.localStorage, {
      mode: nextSelection.mode,
      horizonPolicy: nextSelection.horizonPolicy,
      chrome: nextChrome,
    });
  };
  const choose = (next: ChartSelection) => {
    setSelection(next);
    persist(next, chrome);
  };
  const restyle = (next: ChartChrome) => {
    setChrome(next);
    persist(selection, next);
  };

  const curves = useMemo(() => {
    const painted =
      selection.mode === "structure" ? combinedDateCurves(evaluation, selection) : visibleCurves(evaluation, selection);
    if (selection.mode === "waterfall") {
      return painted.map((curve) => {
        const expiry = evaluation.horizons.some((horizon) => horizon.id === curve.horizonId && horizon.settlement);
        return {
          ...curve,
          width: chrome.thickness + (expiry ? 1 : 0),
          dash: chrome.stroke === "dashed" && !expiry ? (curve.dash ?? "6 3") : curve.dash,
        };
      });
    }
    return applyCurveLook(
      painted,
      { colorMode: chrome.colorMode, stroke: chrome.stroke, thickness: chrome.thickness },
      evaluation,
    );
  }, [evaluation, selection, chrome.colorMode, chrome.stroke, chrome.thickness]);
  const onHome = useCallback((next: ChartView) => {
    setHome((prev) => (sameView(prev, next) ? prev : next));
  }, [setHome]);
  const shown = view ?? home;
  const quiet = evaluation.structures.filter(
    (row): row is PricedStructure => row.status === "priced" && row.sizing.status === "sized" && row.sizing.packages === 0,
  );
  const capital = evaluation.basis.kind === "equalCapital" ? evaluation.basis.capital : null;

  if (priced.length === 0 && quiet.length === 0) {
    return <p className="text-sm text-zinc-700 dark:text-zinc-300">Add a structure to draw P&amp;L by horizon.</p>;
  }

  const dateChoices = [...evaluation.horizons].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.settlement ? 1 : -1));
  const multiDates = selection.mode === "quarters" || selection.mode === "custom";
  const singleDate = selection.mode === "span" || selection.mode === "dateOverlay" || selection.mode === "structure";
  const singleChoices =
    selection.mode === "span"
      ? dateChoices.filter((horizon) => !horizon.settlement && horizon.date !== evaluation.entryDate)
      : dateChoices;

  const commitWindow = (minText: string, maxText: string) => {
    const min = Number(minText);
    const max = Number(maxText);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      onEdit({ kind: "setWindow", window: { kind: "manual", min, max } });
    }
    setMinDraft(null);
    setMaxDraft(null);
  };

  const useLook = true;
  const dateLabel = shortHorizon(
    evaluation.horizons.find((horizon) => horizon.id === selection.focusHorizonId)?.label ?? "this date",
  );
  const chartTitle = selection.mode === "structure" ? `All structures on this date · ${dateLabel}` : evaluation.metric;
  const chartMetric = selection.mode === "structure" ? evaluation.metric : "";

  return (
    <div className="relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 space-y-3 px-4 sm:px-6" data-chart-mode={selection.mode}>
      <div id="chart-display" role="group" aria-label="Chart display" className="flex flex-wrap gap-1.5">
        {CHART_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            aria-pressed={selection.mode === mode.id}
            onClick={() => {
              setView(null);
              choose(setChartMode(selection, mode.id));
            }}
            className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
              selection.mode === mode.id
                ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
                : "border border-zinc-500 text-zinc-800 hover:border-zinc-700 dark:border-zinc-400 dark:text-zinc-100 dark:hover:border-zinc-200"
            }`}
          >
            {mode.label}
          </button>
        ))}
      </div>
      <p className="text-xs text-zinc-700 dark:text-zinc-300">{MODE_HINT[selection.mode]}</p>

      <StructurePicker
        mode={selection.mode}
        priced={priced}
        selection={selection}
        onToggle={(id) => choose(toggleStructure(selection, id))}
        onSet={(ids) => choose(setStructures(selection, ids))}
      />

      {multiDates || (singleDate && singleChoices.length > 0) ? (
        <DatePicker
          mode={selection.mode}
          horizons={singleDate ? singleChoices : dateChoices}
          selection={selection}
          multi={multiDates}
          onToggle={(id) => choose(toggleHorizon(selection, id, evaluation.horizons))}
          onSet={(ids, policy) => choose(setHorizons(selection, ids, policy ?? policyFromIds(evaluation.horizons, ids)))}
          onFocus={(id) => choose(setFocusHorizon(selection, id))}
        />
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <Toggle on={chrome.showCrossovers} onClick={() => restyle({ ...chrome, showCrossovers: !chrome.showCrossovers })} label="Crossovers" />
        <Toggle on={chrome.showZones} onClick={() => restyle({ ...chrome, showZones: !chrome.showZones })} label="Zones" />
        <Toggle on={chrome.showStrikes} onClick={() => restyle({ ...chrome, showStrikes: !chrome.showStrikes })} label="Strikes" />
        <Toggle on={chrome.showBreakevens} onClick={() => restyle({ ...chrome, showBreakevens: !chrome.showBreakevens })} label="Breakevens" />
        <Toggle
          on={chrome.showStock}
          onClick={() => {
            const showStock = !chrome.showStock;
            restyle({ ...chrome, showStock });
            onEdit({ kind: "setShowStock", show: showStock });
          }}
          label="Stock"
        />
        <label className={labLabel}>
          Min spot
          <input
            aria-label="Spot window minimum"
            type="number"
            step="1"
            value={minDraft ?? spotText(shown?.xMin ?? evaluation.spotWindow.min)}
            onChange={(event) => setMinDraft(event.target.value)}
            onBlur={() => {
              if (minDraft == null) return;
              setView(null);
              commitWindow(minDraft, maxDraft ?? spotText(shown?.xMax ?? evaluation.spotWindow.max));
            }}
            className={`mt-1 block w-24 px-2 py-1 text-sm tabular-nums ${labControl}`}
          />
        </label>
        <label className={labLabel}>
          Max spot
          <input
            aria-label="Spot window maximum"
            type="number"
            step="1"
            value={maxDraft ?? spotText(shown?.xMax ?? evaluation.spotWindow.max)}
            onChange={(event) => setMaxDraft(event.target.value)}
            onBlur={() => {
              if (maxDraft == null) return;
              setView(null);
              commitWindow(minDraft ?? spotText(shown?.xMin ?? evaluation.spotWindow.min), maxDraft);
            }}
            className={`mt-1 block w-24 px-2 py-1 text-sm tabular-nums ${labControl}`}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setView(null);
            setMinDraft(null);
            setMaxDraft(null);
            onEdit({ kind: "setWindow", window: { kind: "fit" } });
          }}
          className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
        >
          Fit all crossovers
        </button>
        <p className="pb-1 text-xs text-zinc-700 dark:text-zinc-300">
          {view && shown
            ? `Zoomed. Visible price ${spotText(shown.xMin)}–${spotText(shown.xMax)}.`
            : evaluation.spotWindow.source === "fit"
              ? "Fitted to crossovers, breakevens, strikes, and spot."
              : "Typed spot window."}{" "}
          Spot stays on.
        </p>
        <ChartLookControls
          chrome={chrome}
          onChrome={(next) => {
            if (yAxisDiffers(chrome.yAxis, next.yAxis)) setView(null);
            restyle(next);
          }}
          yMinDraft={yMinDraft}
          yMaxDraft={yMaxDraft}
          onYMin={setYMinDraft}
          onYMax={setYMaxDraft}
          suggestMin={home?.yMin ?? -1000}
          suggestMax={home?.yMax ?? 1000}
        />
      </div>
      {quiet.map((row) => (
        <p key={row.spec.id} className="rounded-lg border border-amber-400 bg-zinc-950 px-3 py-2 text-sm text-amber-200">
          {capital != null ? zeroPackageNotice(row.spec.label, capital, packageCostOf(row)) : `${row.spec.label} has no sized packages.`}
          {evaluation.basis.kind === "equalCapital" && evaluation.basis.units === "whole" ? (
            <button
              type="button"
              className="ml-2 underline decoration-amber-300 underline-offset-2"
              onClick={() =>
                onEdit({
                  kind: "setBasis",
                  basis: { kind: "equalCapital", capital: evaluation.basis.kind === "equalCapital" ? evaluation.basis.capital : 10_000, units: "fractional" },
                })
              }
            >
              Size fractionally
            </button>
          ) : null}
        </p>
      ))}

      {curves.length === 0 ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {quiet.length > 0 ? "That curve stays off the chart until a package fits." : "Select a structure and a date to draw P&L."}
        </p>
      ) : (
        <PlotCard
          title={chartTitle}
          metric={chartMetric}
          evaluation={evaluation}
          priced={priced}
          curves={curves}
          chrome={chrome}
          masked={masked}
          whatIfSpot={whatIfSpot}
          view={view}
          onView={setView}
          onHome={onHome}
          restyle={restyle}
          useLook={useLook}
        />
      )}
    </div>
  );
}

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

function PlotCard({
  title,
  metric,
  evaluation,
  priced,
  curves,
  chrome,
  masked,
  whatIfSpot,
  view,
  onView,
  onHome,
  restyle,
  useLook,
}: {
  title: string;
  metric: string;
  evaluation: LabEvaluation;
  priced: readonly PricedStructure[];
  curves: readonly CurveView[];
  chrome: ChartChrome;
  masked: boolean;
  whatIfSpot: number | null;
  view: ChartView | null;
  onView: (next: ChartView | null) => void;
  onHome: (next: ChartView) => void;
  restyle: (chrome: ChartChrome) => void;
  useLook: boolean;
}) {
  const rows = useMemo(() => buildChartRows(evaluation, curves, chrome.showStock), [evaluation, curves, chrome.showStock]);
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
    chrome.showCrossovers ? crossoverCallouts(evaluation, curves, { min: shown.xMin, max: shown.xMax }) : []
  ).filter((callout) => {
    const y = calloutY(priced, curves, callout.horizonId, callout.structureId, callout.spot);
    return y != null && y >= shown.yMin && y <= shown.yMax;
  });
  const zones = chrome.showZones ? zoneBands(evaluation, curves, shown.xMin, shown.xMax) : [];
  const inX = (spot: number) => spot >= shown.xMin - 1e-8 && spot <= shown.xMax + 1e-8;
  const strikeSpots = chrome.showStrikes
    ? [...new Set(marked.flatMap((row) => row.legs.map((leg) => leg.strike)))].filter(inX).sort((a, b) => a - b)
    : [];
  const breakevens = chrome.showBreakevens
    ? marked.flatMap((row) => row.risk.breakevens.filter(inX).map((spot) => ({ spot, id: row.spec.id, color: seriesColor(row.spec.slot) })))
    : [];
  const stockId = chrome.showStock ? stockHorizonId(evaluation, curves) : null;
  const stock = stockId ? evaluation.stock.find((series) => series.horizonId === stockId) : undefined;
  const yTicks = niceAxis(shown.yMin, shown.yMax).ticks.filter((tick) => tick >= shown.yMin - 1e-6 && tick <= shown.yMax + 1e-6);

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
      <section className="rounded-xl border border-zinc-600 bg-zinc-950 p-3 text-sm text-zinc-300">
        {title ? <p className="text-base font-semibold text-zinc-100">{title}</p> : null}
        <p className="mt-2">Nothing to draw until a package fits and a date is on.</p>
      </section>
    );
  }

  return (
    <section className="rounded-xl border border-zinc-600 bg-zinc-950 p-3 text-zinc-100" data-chart-layout="single">
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
          <ComposedChart data={rows} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
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
              tickFormatter={(value: number) => (masked ? "XXXXX" : formatSignedUsd2(value))}
              width={96}
              allowDataOverflow
              tick={{ fill: LAB_PALETTE.axis, fontSize: 13 }}
              axisLine={{ stroke: LAB_PALETTE.axisLine }}
              tickLine={{ stroke: LAB_PALETTE.axisLine }}
            />
            <Tooltip content={<ChartTip mask={masked} structures={marked} />} cursor={{ stroke: LAB_PALETTE.spot, strokeWidth: 1.5 }} />
            {zones.map((zone) => (
              <ReferenceArea key={zone.key} x1={zone.x1} x2={zone.x2} fill={zone.color} fillOpacity={LAB_PALETTE.zoneOpacity} strokeOpacity={0} />
            ))}
            {strikeSpots.map((strike) => (
              <ReferenceLine key={strike} x={strike} stroke={LAB_PALETTE.strike} strokeWidth={1} strokeDasharray="3 3" />
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
                type="linear"
                dataKey={curve.key}
                name={curve.name}
                stroke={curve.color}
                strokeDasharray={curve.dash}
                strokeOpacity={!useLook || chrome.focusedCurveKey == null || chrome.focusedCurveKey === curve.key ? 1 : chrome.dimOpacity}
                dot={false}
                strokeWidth={curve.width}
                isAnimationActive={false}
              />
            ))}
            {stock ? (
              <Line
                type="linear"
                dataKey="stock"
                name={`Stock · ${shortHorizon(evaluation.horizons.find((horizon) => horizon.id === stockId)?.label ?? "Stock")}`}
                stroke={LAB_PALETTE.stock}
                strokeDasharray="6 4"
                dot={false}
                strokeWidth={LAB_PALETTE.stockLine}
                isAnimationActive={false}
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
          const focused = chrome.focusedCurveKey === curve.key;
          const dimmed = useLook && chrome.focusedCurveKey != null && !focused;
          return (
            <button
              key={curve.key}
              type="button"
              aria-pressed={focused}
              onClick={() => restyle({ ...chrome, focusedCurveKey: focused ? null : curve.key })}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-100"
              style={{ opacity: dimmed ? chrome.dimOpacity : 1 }}
            >
              <Swatch color={curve.color} width={curve.width} dash={curve.dash} />
              {curve.name}
            </button>
          );
        })}
        {stock ? (
          <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
            <Swatch color={LAB_PALETTE.stock} width={LAB_PALETTE.stockLine} dash="6 4" />
            Stock
          </span>
        ) : null}
      </div>
      {chrome.showCrossovers ? (
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
    </section>
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

function buildChartRows(evaluation: LabEvaluation, curves: readonly CurveView[], showStock: boolean): Row[] {
  const priced = evaluation.structures.filter(isPlottableStructure);
  const spots =
    evaluation.axis.length > 0 ? evaluation.axis : (priced[0]?.curves[0]?.points.map((point) => point.spot) ?? []);
  const stockId = showStock ? stockHorizonId(evaluation, curves) : null;
  const stock = stockId ? evaluation.stock.find((series) => series.horizonId === stockId) : undefined;
  return spots.map((spot) => {
    const row: Row = { spot };
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
  rows: readonly Row[],
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
  const windowY =
    yAxis.kind === "manual"
      ? { min: yAxis.min, max: yAxis.max }
      : (ySpanForX(samples, spotWindow.min, spotWindow.max) ?? dataY);
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

function yAxisDiffers(current: ChartChrome["yAxis"], next: ChartChrome["yAxis"]): boolean {
  if (current.kind !== next.kind) return true;
  return current.kind === "manual" && next.kind === "manual" && (current.min !== next.min || current.max !== next.max);
}


function StructurePicker({
  mode,
  priced,
  selection,
  onToggle,
  onSet,
}: {
  mode: ChartMode;
  priced: readonly PricedStructure[];
  selection: ChartSelection;
  onToggle: (id: string) => void;
  onSet: (ids: string[]) => void;
}) {
  const ids = priced.map((row) => row.spec.id);
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">Structures</span>
        <TextButton onClick={() => onSet(ids)}>Select all</TextButton>
        <TextButton onClick={() => onSet([])}>Clear</TextButton>
      </div>
      {mode === "custom" ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {priced.map((row) => {
            const color = seriesColor(row.spec.slot);
            const on = selection.structureIds.includes(row.spec.id);
            return (
              <li key={row.spec.id}>
                <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                  <input
                    type="checkbox"
                    checked={on}
                    onChange={() => onToggle(row.spec.id)}
                    className="accent-zinc-100"
                    style={{ accentColor: color }}
                  />
                  <span style={{ color }}>{row.spec.label}</span>
                </label>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {priced.map((row) => {
            const color = seriesColor(row.spec.slot);
            const on = selection.structureIds.includes(row.spec.id);
            const focus = mode === "waterfall" && on && row.spec.id === selection.focusStructureId;
            return (
              <button
                key={row.spec.id}
                type="button"
                aria-pressed={on}
                onClick={() => onToggle(row.spec.id)}
                className="rounded-full px-3 py-1 text-xs font-semibold text-zinc-950"
                style={{
                  backgroundColor: on ? color : "transparent",
                  color: on ? "#09090b" : color,
                  border: `1px solid ${color}`,
                  boxShadow: focus ? `0 0 0 2px #09090b, 0 0 0 4px ${color}` : undefined,
                }}
              >
                {row.spec.label}
                {focus ? " · rainbow" : ""}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function DatePicker({
  mode,
  horizons,
  selection,
  multi,
  onToggle,
  onSet,
  onFocus,
}: {
  mode: ChartMode;
  horizons: LabEvaluation["horizons"];
  selection: ChartSelection;
  multi: boolean;
  onToggle: (id: string) => void;
  onSet: (ids: string[], policy?: HorizonPolicy) => void;
  onFocus: (id: string) => void;
}) {
  const ids = horizons.map((horizon) => horizon.id);
  const adjustable = mode === "quarters" || mode === "custom";
  const label = mode === "span" ? "Middle date" : mode === "dateOverlay" || mode === "structure" ? "Date" : "Dates";
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{label}</span>
        {multi ? (
          <>
            <TextButton onClick={() => onSet(ids, { kind: "all" })}>Select all</TextButton>
            <TextButton onClick={() => onSet([], { kind: "none" })}>None</TextButton>
            {adjustable ? (
              <>
                <TextButton onClick={() => onSet(everyNthHorizonIds(horizons, 2), { kind: "every", step: 2 })}>Every 2nd</TextButton>
                <TextButton onClick={() => onSet(everyNthHorizonIds(horizons, 4), { kind: "every", step: 4 })}>Every 4th</TextButton>
                <TextButton onClick={() => onSet(expiryPlusOneIds(horizons, selection.focusHorizonId), { kind: "expiryPlus" })}>
                  Expiry + one date
                </TextButton>
              </>
            ) : null}
          </>
        ) : null}
      </div>
      {mode === "custom" ? (
        <ul className="flex flex-wrap gap-x-4 gap-y-1">
          {horizons.map((horizon) => (
            <li key={horizon.id}>
              <label className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
                <input
                  type="checkbox"
                  checked={selection.horizonIds.includes(horizon.id)}
                  onChange={() => onToggle(horizon.id)}
                  className="accent-zinc-100"
                />
                {shortHorizon(horizon.label)}
              </label>
            </li>
          ))}
        </ul>
      ) : (
        <div className="flex flex-wrap gap-1.5">
          {horizons.map((horizon) => {
            const on = multi ? selection.horizonIds.includes(horizon.id) : selection.focusHorizonId === horizon.id;
            return (
              <button
                key={horizon.id}
                type="button"
                aria-pressed={on}
                onClick={() => (multi ? onToggle(horizon.id) : onFocus(horizon.id))}
                className={`rounded-full px-3 py-1 text-xs font-semibold ${
                  on
                    ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
                    : "border border-zinc-500 text-zinc-800 dark:border-zinc-400 dark:text-zinc-100"
                }`}
              >
                {shortHorizon(horizon.label)}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}

function ChartLookControls({
  chrome,
  onChrome,
  yMinDraft,
  yMaxDraft,
  onYMin,
  onYMax,
  suggestMin,
  suggestMax,
}: {
  chrome: ChartChrome;
  onChrome: (next: ChartChrome) => void;
  yMinDraft: string | null;
  yMaxDraft: string | null;
  onYMin: (value: string | null) => void;
  onYMax: (value: string | null) => void;
  suggestMin: number;
  suggestMax: number;
}) {
  const commitY = (minText: string, maxText: string) => {
    const min = Number(minText);
    const max = Number(maxText);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) onChrome({ ...chrome, yAxis: { kind: "manual", min, max } });
    onYMin(null);
    onYMax(null);
  };
  return (
    <div className="flex flex-wrap items-end gap-3">
      <label className={labLabel}>
        Line thickness
        <input
          aria-label="Line thickness"
          type="range"
          min={1.5}
          max={6}
          step={0.5}
          value={chrome.thickness}
          onChange={(event) => onChrome({ ...chrome, thickness: Number(event.target.value) })}
          className="mt-1 block w-28 accent-zinc-100"
        />
      </label>
      <label className={labLabel}>
        Other lines
        <input
          aria-label="Opacity of other lines"
          type="range"
          min={0.15}
          max={1}
          step={0.05}
          value={chrome.dimOpacity}
          onChange={(event) => onChrome({ ...chrome, dimOpacity: Number(event.target.value) })}
          className="mt-1 block w-28 accent-zinc-100"
        />
      </label>
      <div className="flex gap-1">
        <Toggle on={chrome.colorMode === "rainbow"} onClick={() => onChrome({ ...chrome, colorMode: "rainbow" })} label="Rainbow" />
        <Toggle on={chrome.colorMode === "structure"} onClick={() => onChrome({ ...chrome, colorMode: "structure" })} label="Structure colors" />
      </div>
      <div className="flex gap-1">
        <Toggle on={chrome.stroke === "solid"} onClick={() => onChrome({ ...chrome, stroke: "solid" })} label="Solid" />
        <Toggle on={chrome.stroke === "dashed"} onClick={() => onChrome({ ...chrome, stroke: "dashed" })} label="Dashed" />
      </div>
      <Toggle on={chrome.yAxis.kind === "auto"} onClick={() => onChrome({ ...chrome, yAxis: { kind: "auto" } })} label="Y auto" />
      {chrome.yAxis.kind === "manual" ? (
        <>
          <label className={labLabel}>
            Y min
            <input
              aria-label="Y axis minimum"
              type="number"
              value={yMinDraft ?? String(chrome.yAxis.min)}
              onChange={(event) => onYMin(event.target.value)}
              onBlur={() => {
                if (yMinDraft == null || chrome.yAxis.kind !== "manual") return;
                commitY(yMinDraft, yMaxDraft ?? String(chrome.yAxis.max));
              }}
              className={`mt-1 block w-24 px-2 py-1 text-sm tabular-nums ${labControl}`}
            />
          </label>
          <label className={labLabel}>
            Y max
            <input
              aria-label="Y axis maximum"
              type="number"
              value={yMaxDraft ?? String(chrome.yAxis.max)}
              onChange={(event) => onYMax(event.target.value)}
              onBlur={() => {
                if (yMaxDraft == null || chrome.yAxis.kind !== "manual") return;
                commitY(yMinDraft ?? String(chrome.yAxis.min), yMaxDraft);
              }}
              className={`mt-1 block w-24 px-2 py-1 text-sm tabular-nums ${labControl}`}
            />
          </label>
        </>
      ) : (
        <TextButton
          onClick={() => onChrome({ ...chrome, yAxis: { kind: "manual", min: suggestMin, max: suggestMax } })}
        >
          Y manual
        </TextButton>
      )}
    </div>
  );
}

function Toggle({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      onClick={onClick}
      className={`rounded-full px-3 py-1.5 text-xs font-semibold ${
        on
          ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
          : "border border-zinc-500 text-zinc-800 dark:border-zinc-400 dark:text-zinc-100"
      }`}
    >
      {label}
    </button>
  );
}

function TextButton({ onClick, children }: { onClick: () => void; children: string }) {
  return (
    <button type="button" onClick={onClick} className="text-xs font-semibold text-zinc-800 underline decoration-zinc-500 underline-offset-2 dark:text-zinc-100">
      {children}
    </button>
  );
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
