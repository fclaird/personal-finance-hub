"use client";

import { useEffect, useLayoutEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from "react";
import { CartesianGrid, ComposedChart, Line, ReferenceLine, Tooltip, XAxis, YAxis } from "recharts";

import {
  READOUT_MOVES,
  deltaAlong,
  deltaReadoutAt,
  pathSpots,
  type SpreadCandidate,
} from "@/lib/strategyLab/callSpreadOptimizer";
import { shortHorizon } from "@/lib/strategyLab/chartDisplay";
import { forwardDateSteps, forwardStepId, forwardStepLabel, yearsUntilExpiry, type ForwardDateStep } from "@/lib/strategyLab/dateSteps";
import type { IsoDate } from "@/lib/optionChain/chain";
import { panView, zoomAroundCursor, type ChartPoint, type ChartView } from "@/lib/strategyLab/chartView";
import {
  assignOptimalLanes,
  deltaExtremum,
  effectiveOptimalLabel,
  effectiveOptimalReadout,
  OPTIMAL_LANE_PX,
  type DeltaSample,
} from "@/lib/strategyLab/deltaExtremum";
import {
  DELTA_SOURCE_LABEL,
  analysisSeries,
  analysisShareDelta,
  type DeltaChartSource,
} from "@/lib/strategyLab/deltaSource";
import { seriesReactKey } from "@/lib/strategyLab/displayNames";
import type { LabEvaluation } from "@/lib/strategyLab/lab";
import { LAB_PALETTE, seriesColor } from "@/lib/strategyLab/palette";
import { CHART_ENGAGE_HINT, CHART_SIZE_HEIGHT, type ChartSize } from "@/app/components/strategyLab/StrategyPlot";

const BOX = { width: "100%", maxWidth: "100%", minWidth: 0, boxSizing: "border-box" as const };
const SIZE_LABEL: Record<ChartSize, string> = { fit: "Fit", large: "Large", huge: "Huge" };

type Series = { readonly key: string; readonly name: string; readonly color: string; readonly selected: boolean };

export function OptimizerDeltaChart({
  rows,
  spot,
  years,
  tradeDate,
  expiry,
  preview,
  anchored,
  source,
  onSource,
  evaluation,
  plottedIds,
}: {
  rows: readonly SpreadCandidate[];
  spot: number;
  years: number;
  tradeDate: IsoDate;
  expiry: IsoDate | null;
  preview: boolean;
  anchored: boolean;
  source: DeltaChartSource;
  onSource: (source: DeltaChartSource) => void;
  evaluation: LabEvaluation | null;
  plottedIds: readonly string[] | null;
}) {
  const steps = useMemo(() => (expiry ? forwardDateSteps(tradeDate, expiry) : []), [tradeDate, expiry]);
  const [pickedStep, setPickedStep] = useState<string | null>(null);
  const horizon = steps.some((step) => forwardStepId(step) === pickedStep) ? pickedStep! : steps[0] ? forwardStepId(steps[0]) : null;
  const remainYears = (id: string | null): number => {
    if (!expiry || !id) return years;
    const step = steps.find((item) => forwardStepId(item) === id);
    return step ? yearsUntilExpiry(step, expiry) : years;
  };
  const stepById = (id: string | null): ForwardDateStep | null => steps.find((item) => forwardStepId(item) === id) ?? null;
  const [analysisHorizon, setAnalysisHorizon] = useState<string | null>(null);
  const [allDates, setAllDates] = useState(false);
  const [chartSize, setChartSize] = useState<ChartSize>("fit");
  const [engaged, setEngaged] = useState(false);
  const [view, setView] = useState<ChartView | null>(null);
  const [plotPx, setPlotPx] = useState({ width: 0, height: 0 });
  const [dragging, setDragging] = useState(false);
  const plotRef = useRef<HTMLDivElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const dragRef = useRef<{ pointerId: number; startX: number; startY: number; origin: ChartView; grid: DOMRect } | null>(null);

  const analysisRows = useMemo(
    () => (evaluation ? analysisSeries(evaluation, plottedIds) : []),
    [evaluation, plottedIds],
  );
  const analysisHorizons = useMemo(() => evaluation?.horizons ?? [], [evaluation]);
  const analysisFocus = analysisHorizons.some((item) => item.id === analysisHorizon)
    ? analysisHorizon
    : (analysisHorizons[0]?.id ?? null);
  const single = source === "optimizer" && rows.length === 1 ? rows[0]! : null;
  const analysisSingle = source === "analysis" && analysisRows.length === 1 ? analysisRows[0]! : null;
  const showAll = allDates && (single != null || analysisSingle != null);
  const series = useMemo<Series[]>(() => {
    if (source === "analysis") {
      if (showAll && analysisSingle) {
        return analysisHorizons.map((item, index) => ({
          key: item.id,
          name: shortHorizon(item.label),
          color: seriesColor(index),
          selected: false,
        }));
      }
      return analysisRows.map((row) => ({
        key: row.id,
        name: row.label,
        color: seriesColor(row.slot),
        selected: false,
      }));
    }
    if (showAll && single) {
      return steps.map((item, index) => ({
        key: forwardStepId(item),
        name: shortHorizon(forwardStepLabel(item, false)),
        color: seriesColor(index),
        selected: false,
      }));
    }
    const drawn = rows.map((row, index) => ({
      key: row.key,
      name: row.selected
        ? `${strikeText(row.longStrike)}/${strikeText(row.shortStrike)} · selected`
        : `${strikeText(row.longStrike)}/${strikeText(row.shortStrike)}`,
      color: row.selected ? "#fbbf24" : seriesColor(index),
      selected: row.selected,
    }));
    return [...drawn.filter((item) => !item.selected), ...drawn.filter((item) => item.selected)];
  }, [source, rows, showAll, single, analysisRows, analysisHorizons, analysisSingle, steps]);

  const spots = useMemo(() => {
    if (source === "analysis" && evaluation) {
      const strikes = evaluation.structures
        .filter((row) => analysisRows.some((item) => item.id === row.spec.id))
        .flatMap((row) => row.spec.legs.map((leg) => leg.strike).filter((strike): strike is number => strike != null));
      return pathSpots(
        spot,
        strikes.map((strike) => ({ longStrike: strike, shortStrike: strike })),
      );
    }
    return pathSpots(spot, rows);
  }, [source, evaluation, analysisRows, spot, rows]);
  const data = useMemo(() => {
    return spots.map((price) => {
      const point: Record<string, number> = { spot: price };
      if (source === "analysis" && evaluation) {
        if (showAll && analysisSingle) {
          for (const item of analysisHorizons) {
            const value = analysisShareDelta(evaluation, analysisSingle.id, item.id, price);
            if (value != null) point[item.id] = value;
          }
        } else if (analysisFocus) {
          for (const row of analysisRows) {
            const value = analysisShareDelta(evaluation, row.id, analysisFocus, price);
            if (value != null) point[row.id] = value;
          }
        }
        return point;
      }
      if (showAll && single) {
        for (const item of steps) {
          point[forwardStepId(item)] = deltaAlong(single, [price], expiry ? yearsUntilExpiry(item, expiry) : years)[0]?.delta ?? 0;
        }
      } else {
        for (const row of rows) {
          point[row.key] = deltaAlong(row, [price], remainYears(horizon))[0]?.delta ?? 0;
        }
      }
      return point;
    });
  }, [spots, rows, years, horizon, showAll, single, source, evaluation, analysisRows, analysisHorizons, analysisSingle, analysisFocus, steps, expiry]);

  const optima = useMemo(() => {
    return series.flatMap((item) => {
      const found = deltaExtremum(curveSamples(data, item.key), (price) => {
        if (source === "analysis" && evaluation) {
          const structureId = showAll && analysisSingle ? analysisSingle.id : item.key;
          const horizonId = showAll && analysisSingle ? item.key : analysisFocus;
          if (!horizonId) return null;
          const value = analysisShareDelta(evaluation, structureId, horizonId, price);
          return value == null || !Number.isFinite(value) ? null : value;
        }
        const row = showAll && single ? single : rows.find((candidate) => candidate.key === item.key);
        const horizonId = showAll && single ? item.key : horizon;
        if (!row) return null;
        const value = deltaAlong(row, [price], remainYears(horizonId))[0]?.delta;
        return value == null || !Number.isFinite(value) ? null : value;
      });
      return found ? [{ key: item.key, color: item.color, price: found.price, delta: found.delta }] : [];
    });
  }, [series, data, source, evaluation, showAll, analysisSingle, analysisFocus, single, rows, years, horizon, steps, expiry]);

  const readoutOptimal = useMemo(() => {
    const prices = new Map<string, { price: number; delta: number }>();
    if (!showAll) {
      for (const item of optima) prices.set(item.key, { price: item.price, delta: item.delta });
      return prices;
    }
    if (source === "analysis" && evaluation && analysisFocus) {
      for (const row of analysisRows) {
        const samples = spots.flatMap((price) => {
          const delta = analysisShareDelta(evaluation, row.id, analysisFocus, price);
          return delta == null || !Number.isFinite(delta) ? [] : [{ price, delta }];
        });
        const found = deltaExtremum(samples, (price) => analysisShareDelta(evaluation, row.id, analysisFocus, price));
        if (found) prices.set(row.id, { price: found.price, delta: found.delta });
      }
      return prices;
    }
    for (const row of rows) {
      const samples = deltaAlong(row, spots, remainYears(horizon)).map((point) => ({ price: point.spot, delta: point.delta }));
      const found = deltaExtremum(samples, (price) => {
        const value = deltaAlong(row, [price], remainYears(horizon))[0]?.delta;
        return value == null || !Number.isFinite(value) ? null : value;
      });
      if (found) prices.set(row.key, { price: found.price, delta: found.delta });
    }
    return prices;
  }, [showAll, optima, source, evaluation, analysisFocus, analysisRows, spots, rows, years, horizon, steps, expiry]);

  const home = useMemo(() => frameOf(data, series.map((item) => item.key)), [data, series]);
  const shown = view ?? home;
  const shownRef = useRef(shown);
  const limitsRef = useRef(home);
  useLayoutEffect(() => {
    shownRef.current = shown;
    limitsRef.current = home;
  }, [shown, home]);

  useLayoutEffect(() => {
    const node = plotRef.current;
    if (!node) return;
    const measure = () => {
      const width = Math.floor(node.clientWidth);
      const height = Math.floor(node.clientHeight);
      setPlotPx((prev) => (prev.width === width && prev.height === height ? prev : { width, height }));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [chartSize, rows.length, source, analysisRows.length]);

  useEffect(() => {
    const node = plotRef.current;
    if (!node || !engaged) return;
    const onWheel = (event: WheelEvent) => {
      event.preventDefault();
      const grid = node.querySelector(".recharts-cartesian-grid")?.getBoundingClientRect();
      const current = shownRef.current;
      if (!grid || grid.width < 2 || !current) return;
      const cursor = pointToData(event.clientX, event.clientY, grid, current);
      const unit = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 800 : 1;
      const factor = Math.exp(-event.deltaY * unit * 0.0012);
      const next = zoomAroundCursor(current, cursor, factor, limitsRef.current);
      shownRef.current = next;
      setView(next);
    };
    node.addEventListener("wheel", onWheel, { passive: false });
    return () => node.removeEventListener("wheel", onWheel);
  }, [engaged, rows.length]);

  useEffect(() => {
    if (!engaged) return;
    const onPointerDown = (event: PointerEvent) => {
      const root = sectionRef.current;
      if (!root || !(event.target instanceof Node) || root.contains(event.target)) return;
      setEngaged(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      const tag = (event.target as HTMLElement | null)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      setEngaged(false);
    };
    document.addEventListener("pointerdown", onPointerDown);
    window.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      window.removeEventListener("keydown", onKey);
    };
  }, [engaged]);

  const readoutStep = stepById(horizon);
  const readoutYears = remainYears(horizon);
  const readoutLabel = readoutStep ? shortHorizon(forwardStepLabel(readoutStep, false)) : "Date";
  const readoutRows = source === "optimizer" ? (anchored ? rows.filter((row) => row.selected).concat(rows.filter((row) => !row.selected)) : rows).slice(0, 8) : [];
  const analysisReadout = source === "analysis" && evaluation && analysisFocus ? analysisRows.slice(0, 8) : [];
  const empty = source === "analysis" ? analysisRows.length === 0 : rows.length === 0;

  const onPointerDown = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (!engaged || event.button !== 0) return;
    const node = plotRef.current;
    const grid = node?.querySelector(".recharts-cartesian-grid")?.getBoundingClientRect();
    const current = shownRef.current;
    if (!node || !grid || !current) return;
    node.setPointerCapture(event.pointerId);
    dragRef.current = { pointerId: event.pointerId, startX: event.clientX, startY: event.clientY, origin: current, grid };
    setDragging(true);
  };
  const onPointerMove = (event: ReactPointerEvent<HTMLDivElement>) => {
    const drag = dragRef.current;
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dxPx = event.clientX - drag.startX;
    const dyPx = event.clientY - drag.startY;
    if (Math.hypot(dxPx, dyPx) < 3) return;
    const dx = -(dxPx / drag.grid.width) * (drag.origin.xMax - drag.origin.xMin);
    const dy = (dyPx / drag.grid.height) * (drag.origin.yMax - drag.origin.yMin);
    setView(panView(drag.origin, dx, dy, limitsRef.current));
  };
  const onPointerUp = (event: ReactPointerEvent<HTMLDivElement>) => {
    if (dragRef.current?.pointerId !== event.pointerId) return;
    dragRef.current = null;
    setDragging(false);
  };

  const sourceToggle = (
    <div className="mb-3 inline-flex max-w-full flex-wrap gap-1 rounded-full border border-zinc-400 bg-zinc-900 p-1" role="group" aria-label="Effective delta source">
      {(Object.keys(DELTA_SOURCE_LABEL) as DeltaChartSource[]).map((id) => (
        <Chip key={id} label={DELTA_SOURCE_LABEL[id]} pressed={source === id} onClick={() => onSource(id)} />
      ))}
    </div>
  );

  if (empty) {
    return (
      <section className="rounded-xl border border-zinc-600 bg-zinc-950 p-3 text-zinc-100" data-optimizer-chart="" data-delta-source={source}>
        {sourceToggle}
        <p className="text-sm text-zinc-200">
          {source === "analysis"
            ? "Nothing in the main analysis is ready to plot. Load a held book or add a structure, then come back to this chart."
            : "No spreads match these filters."}
        </p>
      </section>
    );
  }

  return (
    <section
      ref={sectionRef}
      className={`box-border w-full min-w-0 max-w-full overflow-hidden rounded-xl bg-zinc-950 p-3 text-zinc-100 ${
        engaged ? "border-2 border-cyan-300" : "border border-zinc-600"
      }`}
      style={BOX}
      data-optimizer-chart=""
      data-delta-source={source}
      data-chart-engaged={engaged ? "true" : "false"}
    >
      {sourceToggle}
      <div className="mb-2 flex min-w-0 flex-wrap items-center gap-1.5" role="toolbar" aria-label="Optimizer chart">
        <Chip label="Interact" pressed={engaged} onClick={() => setEngaged((on) => !on)} />
        <Chip label="Zoom in" onClick={() => shown && setView(zoomAroundCursor(shown, mid(shown), 1.25, home))} />
        <Chip label="Zoom out" onClick={() => shown && setView(zoomAroundCursor(shown, mid(shown), 0.8, home))} />
        <Chip label="Reset view" onClick={() => setView(null)} />
        <div className="flex gap-1" role="group" aria-label="Chart size">
          {(Object.keys(SIZE_LABEL) as ChartSize[]).map((size) => (
            <Chip key={size} label={SIZE_LABEL[size]} pressed={chartSize === size} onClick={() => setChartSize(size)} />
          ))}
        </div>
      </div>
      <p className={`mb-2 text-xs ${engaged ? "font-semibold text-cyan-200" : "text-zinc-400"}`} data-chart-hint={engaged ? "active" : "idle"}>
        {engaged ? CHART_ENGAGE_HINT : "Wheel and touch scroll the page. Click the chart or Interact to zoom."}
      </p>
      <div className="mb-2 flex min-w-0 flex-wrap gap-1.5" role="group" aria-label="Delta horizon">
        {source === "analysis"
          ? analysisHorizons.map((item) => (
              <Chip
                key={item.id}
                label={shortHorizon(item.label)}
                pressed={!showAll && analysisFocus === item.id}
                onClick={() => {
                  setAllDates(false);
                  setAnalysisHorizon(item.id);
                  setView(null);
                }}
              />
            ))
          : steps.map((item) => (
              <Chip
                key={forwardStepId(item)}
                label={shortHorizon(forwardStepLabel(item, false))}
                pressed={!showAll && horizon === forwardStepId(item)}
                onClick={() => {
                  setAllDates(false);
                  setPickedStep(forwardStepId(item));
                  setView(null);
                }}
              />
            ))}
        <Chip
          label="All dates"
          pressed={showAll}
          onClick={() => {
            if (source === "analysis" ? !analysisSingle : !single) return;
            setAllDates(true);
            setView(null);
          }}
        />
      </div>
      <p className="mb-2 text-xs text-zinc-200">
        {source === "analysis"
          ? "Effective delta of the positions loaded in the main analysis. Same share count as that chart."
          : anchored
            ? "The amber line is the spread you picked. The others step both strikes, or move one strike to change the width. Constant IV."
            : preview
              ? "Preview of the top spreads. Check a row to put that spread on the delta chart."
              : showAll
                ? "One spread at each date step through expiry. Constant IV."
                : "Net share-equivalent delta versus price. Constant IV."}{" "}
        {(source === "analysis" ? analysisSingle == null : single == null) && allDates ? "All dates needs a single position." : ""}{" "}
        When a curve turns inside the window, a dashed line marks its effective optimal price.
      </p>
      <div
        ref={plotRef}
        data-chart-plot=""
        className={`relative box-border w-full min-w-0 max-w-full overflow-hidden select-none ${
          !engaged ? "cursor-pointer" : dragging ? "cursor-grabbing" : "cursor-grab"
        }`}
        style={{
          ...BOX,
          height: CHART_SIZE_HEIGHT[chartSize],
          touchAction: engaged ? "none" : "auto",
          overscrollBehavior: engaged ? "contain" : "auto",
        }}
        onClick={() => {
          if (!engaged) setEngaged(true);
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      >
        {plotPx.width > 0 && plotPx.height > 0 && shown ? (
          <div className="absolute inset-0 overflow-hidden" style={{ width: plotPx.width, height: plotPx.height, maxWidth: "100%" }}>
            <ComposedChart
              data={data}
              width={plotPx.width}
              height={plotPx.height}
              style={{ width: plotPx.width, height: plotPx.height, maxWidth: "100%", boxSizing: "border-box" }}
              margin={{ top: 16, right: 16, left: 8, bottom: 8 }}
            >
              <CartesianGrid strokeDasharray="3 3" stroke={LAB_PALETTE.grid} />
              <XAxis
                dataKey="spot"
                type="number"
                domain={[shown.xMin, shown.xMax]}
                tickFormatter={(value: number) => value.toFixed(0)}
                allowDataOverflow
                tick={{ fill: LAB_PALETTE.axis, fontSize: 13 }}
              />
              <YAxis
                domain={[shown.yMin, shown.yMax]}
                width={64}
                allowDataOverflow
                tick={{ fill: LAB_PALETTE.axis, fontSize: 13 }}
                tickFormatter={(value: number) => value.toFixed(0)}
              />
              <Tooltip
                content={({ active, payload }) => {
                  if (!active || !payload?.length) return null;
                  const price = payload[0]?.payload?.spot;
                  const ordered = [...payload].sort((a, b) => Number(b.value) - Number(a.value));
                  return (
                    <div className="rounded-md border border-zinc-500 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100">
                      <div>Spot {typeof price === "number" ? price.toFixed(2) : ""}</div>
                      {ordered.map((item, index) => (
                        <div key={seriesReactKey(item, index)} style={{ color: item.color }}>
                          {item.name} {typeof item.value === "number" ? item.value.toFixed(1) : ""}
                        </div>
                      ))}
                    </div>
                  );
                }}
              />
              <ReferenceLine x={spot} stroke={LAB_PALETTE.spot} strokeDasharray="5 5" label={{ value: "Spot", fill: LAB_PALETTE.spot, fontSize: 12 }} />
              {shown
                ? assignOptimalLanes(
                    optima.map((marker) => ({ ...marker, label: effectiveOptimalLabel(marker.price, marker.delta) })),
                    spot,
                    shown.xMin,
                    shown.xMax,
                    plotPx.width,
                  ).map((marker) => (
                    <ReferenceLine
                      key={marker.key}
                      x={marker.price}
                      stroke={marker.color}
                      strokeDasharray="5 5"
                      label={optimalPriceLabel(marker.label, marker.color, marker.lane, marker.anchorEnd)}
                    />
                  ))
                : null}
              {series.map((item) => (
                <Line
                  key={item.key}
                  type={
                    showAll && (stepById(item.key)?.kind === "expiry" || analysisHorizons.some((horizonItem) => horizonItem.id === item.key && horizonItem.settlement))
                      ? "stepAfter"
                      : source === "optimizer" && stepById(horizon)?.kind === "expiry"
                        ? "stepAfter"
                        : source === "analysis" && analysisHorizons.some((horizonItem) => horizonItem.id === analysisFocus && horizonItem.settlement)
                          ? "stepAfter"
                          : "linear"
                  }
                  dataKey={item.key}
                  name={item.name}
                  stroke={item.color}
                  dot={false}
                  strokeWidth={item.selected ? 4.5 : 2.75}
                  isAnimationActive={false}
                />
              ))}
            </ComposedChart>
          </div>
        ) : null}
      </div>
      <div className="mt-3 min-w-0 max-w-full overflow-x-auto">
        {source === "analysis" && evaluation && analysisFocus ? (
          <table className="w-full text-left text-xs text-zinc-100">
            <caption className="mb-1 text-left text-xs font-semibold text-zinc-200">
              Delta readout · {shortHorizon(analysisHorizons.find((item) => item.id === analysisFocus)?.label ?? "Date")}
            </caption>
            <thead>
              <tr className="text-zinc-300">
                <th className="py-1 pr-3 font-semibold">Position</th>
                {READOUT_MOVES.map((move) => (
                  <th key={move} className="py-1 pr-3 font-semibold">
                    {move === 0 ? "Spot" : `${move > 0 ? "+" : ""}${Math.round(move * 100)}%`}
                  </th>
                ))}
                <th className="py-1 pr-3 font-semibold" title="Price where this curve's slope is zero, and the effective delta there">
                  Optimal price
                </th>
              </tr>
            </thead>
            <tbody>
              {analysisReadout.map((row) => (
                <tr key={row.id} className="border-t border-zinc-700">
                  <td className="py-1 pr-3 font-semibold">{row.label}</td>
                  {READOUT_MOVES.map((move) => {
                    const value = analysisShareDelta(evaluation, row.id, analysisFocus, spot * (1 + move));
                    return (
                      <td key={move} className="py-1 pr-3 tabular-nums">
                        {value == null ? "—" : value.toFixed(1)}
                      </td>
                    );
                  })}
                  <OptimalPriceCell read={readoutOptimal.get(row.id) ?? null} color={series.find((item) => item.key === row.id)?.color} />
                </tr>
              ))}
            </tbody>
          </table>
        ) : readoutRows[0] ? (
          <table className="w-full text-left text-xs text-zinc-100">
            <caption className="mb-1 text-left text-xs font-semibold text-zinc-200">
              Delta readout · {readoutLabel}
            </caption>
            <thead>
              <tr className="text-zinc-300">
                <th className="py-1 pr-3 font-semibold">Spread</th>
                {deltaReadoutAt(readoutRows[0], spot, readoutYears).map((cell) => (
                  <th key={cell.label} className="py-1 pr-3 font-semibold">
                    {cell.label}
                  </th>
                ))}
                <th className="py-1 pr-3 font-semibold" title="Price where this curve's slope is zero, and the effective delta there">
                  Optimal price
                </th>
              </tr>
            </thead>
            <tbody>
              {readoutRows.map((row) => (
                <tr key={row.key} className={row.selected ? "border-t border-amber-300 bg-zinc-800" : "border-t border-zinc-700"}>
                  <td className="py-1 pr-3 font-semibold text-zinc-50">
                    {strikeText(row.longStrike)}/{strikeText(row.shortStrike)}
                    {row.selected ? <span className="ml-2 rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">Selected</span> : null}
                  </td>
                  {deltaReadoutAt(row, spot, readoutYears).map((cell) => (
                    <td key={cell.label} className="py-1 pr-3 tabular-nums">
                      {cell.delta.toFixed(1)}
                    </td>
                  ))}
                  <OptimalPriceCell read={readoutOptimal.get(row.key) ?? null} color={series.find((item) => item.key === row.key)?.color} />
                </tr>
              ))}
            </tbody>
          </table>
        ) : null}
      </div>
    </section>
  );
}

function Chip({ label, pressed, onClick }: { label: string; pressed?: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        pressed ? "bg-zinc-100 text-zinc-950" : "border border-zinc-500 text-zinc-100"
      }`}
    >
      {label}
    </button>
  );
}

function OptimalPriceCell({ read, color }: { read: { price: number; delta: number } | null; color?: string }) {
  return (
    <td
      className="py-1 pr-3 font-semibold tabular-nums"
      data-optimal-price={read == null ? "" : read.price.toFixed(2)}
      data-optimal-delta={read == null ? "" : String(Math.round(read.delta))}
      style={{ color: color ?? "#fafafa" }}
    >
      {read == null ? "—" : effectiveOptimalReadout(read.price, read.delta)}
    </td>
  );
}

function strikeText(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function curveSamples(data: readonly Record<string, number>[], key: string): DeltaSample[] {
  return data.flatMap((row) => {
    const delta = row[key];
    return typeof row.spot === "number" && typeof delta === "number" ? [{ price: row.spot, delta }] : [];
  });
}

function optimalPriceLabel(text: string, fill: string, lane: number, anchorEnd: boolean) {
  function OptimalPriceLabel({ viewBox }: { viewBox?: { x?: number; y?: number } }) {
    const x = viewBox?.x ?? 0;
    const y = (viewBox?.y ?? 0) + 14 + lane * OPTIMAL_LANE_PX;
    return (
      <text
        x={anchorEnd ? x - 6 : x + 6}
        y={y}
        fill={fill}
        stroke="#09090b"
        strokeWidth={3}
        paintOrder="stroke"
        fontSize={13}
        fontWeight={700}
        textAnchor={anchorEnd ? "end" : "start"}
      >
        {text}
      </text>
    );
  }
  return OptimalPriceLabel;
}

function mid(view: ChartView): ChartPoint {
  return { x: (view.xMin + view.xMax) / 2, y: (view.yMin + view.yMax) / 2 };
}

function pointToData(clientX: number, clientY: number, grid: DOMRect, view: ChartView): ChartPoint {
  const x = Math.min(Math.max(clientX, grid.left), grid.right);
  const y = Math.min(Math.max(clientY, grid.top), grid.bottom);
  return {
    x: view.xMin + ((x - grid.left) / grid.width) * (view.xMax - view.xMin),
    y: view.yMax - ((y - grid.top) / grid.height) * (view.yMax - view.yMin),
  };
}

function frameOf(data: readonly Record<string, number>[], keys: readonly string[]): ChartView {
  const xs = data.map((row) => row.spot ?? 0);
  const ys = data.flatMap((row) => keys.map((key) => row[key]).filter((value): value is number => typeof value === "number"));
  const xMin = xs.length ? Math.min(...xs) : 0;
  const xMax = xs.length ? Math.max(...xs) : 1;
  const yMin = ys.length ? Math.min(...ys) : 0;
  const yMax = ys.length ? Math.max(...ys) : 1;
  const xPad = Math.max((xMax - xMin) * 0.04, 0.5);
  const yPad = Math.max((yMax - yMin) * 0.08, 1);
  return { xMin: xMin - xPad, xMax: xMax + xPad, yMin: yMin - yPad, yMax: yMax + yPad };
}
