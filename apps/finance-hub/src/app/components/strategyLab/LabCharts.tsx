"use client";

import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";

import { formatNum, formatSignedUsd2 } from "@/lib/format";
import { StrategyPlot, type ChartRow, type ChartSize } from "@/app/components/strategyLab/StrategyPlot";
import {
  applyHorizonPolicy,
  CHART_MODES,
  applyCurveLook,
  combinedDateCurves,
  defaultChartChrome,
  everyNthHorizonIds,
  expiryPlusOneIds,
  isPlottableStructure,
  initialChartSelection,
  policyFromIds,
  positiveCrossovers,
  readChartSettings,
  reconcileChartSelection,
  setChartMode,
  setFocusHorizon,
  setHorizons,
  setStructures,
  shortHorizon,
  toggleHorizon,
  visibleCurves,
  writeChartSettings,
  type ChartChrome,
  type ChartMode,
  type ChartSelection,
  type HorizonPolicy,
} from "@/lib/strategyLab/chartDisplay";
import { sameView, sharePriceWindow, type ChartView } from "@/lib/strategyLab/chartView";
import {
  hundredLines,
  isExpiryCurve,
  peakDelta,
  sampleStockDelta,
  sampleStructureDelta,
  type DeltaMeasure,
  type DeltaScale,
} from "@/lib/strategyLab/deltaCurves";
import { packageCostOf, zeroPackageNotice, type LabEdit, type LabEvaluation, type PricedStructure, type StructureEval } from "@/lib/strategyLab/lab";
import { applyPlotAction, type PlotAction, type PlotChart } from "@/lib/strategyLab/plotSelection";
import { labControl, labLabel, seriesColor } from "@/lib/strategyLab/palette";

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


function spotText(n: number): string {
  return String(Math.round(n * 100) / 100);
}


function pricedOf(evaluation: LabEvaluation): PricedStructure[] {
  return evaluation.structures.filter(isPlottableStructure);
}


export function LabCharts({
  evaluation,
  masked,
  whatIfSpot,
  onEdit,
  onDeltaPlot,
  bindDeltaToggle,
}: {
  evaluation: LabEvaluation;
  masked: boolean;
  whatIfSpot: number | null;
  onEdit: (edit: LabEdit) => void;
  onDeltaPlot?: (ids: readonly string[]) => void;
  bindDeltaToggle?: (toggle: (id: string) => void) => void;
}) {
  const priced = pricedOf(evaluation);
  const [selection, setSelection] = useState<ChartSelection>(() => initialChartSelection(evaluation));
  const [chrome, setChrome] = useState<ChartChrome>(() => defaultChartChrome());
  const [minDraft, setMinDraft] = useState<string | null>(null);
  const [maxDraft, setMaxDraft] = useState<string | null>(null);
  const [yMinDraft, setYMinDraft] = useState<string | null>(null);
  const [view, setView] = useState<ChartView | null>(null);
  const [home, setHome] = useState<ChartView | null>(null);
  const [pnlLimits, setPnlLimits] = useState<ChartView | null>(null);
  const [yMaxDraft, setYMaxDraft] = useState<string | null>(null);
  const [linkX, setLinkX] = useState(true);
  const [deltaView, setDeltaView] = useState<ChartView | null>(null);
  const [deltaHome, setDeltaHome] = useState<ChartView | null>(null);
  const [deltaScale, setDeltaScale] = useState<DeltaScale>("shares");
  const [deltaMeasure, setDeltaMeasure] = useState<DeltaMeasure>("delta");
  const [showHundred, setShowHundred] = useState(true);
  const [showPeak, setShowPeak] = useState(true);
  const [deltaY, setDeltaY] = useState<ChartChrome["yAxis"]>({ kind: "auto" });
  const [deltaFocus, setDeltaFocus] = useState<string | null>(null);
  const [deltaYMinDraft, setDeltaYMinDraft] = useState<string | null>(null);
  const [deltaYMaxDraft, setDeltaYMaxDraft] = useState<string | null>(null);
  const [linkPlots, setLinkPlots] = useState(true);
  const [chartSize, setChartSize] = useState<ChartSize>("fit");
  const [hundredShareStock, setHundredShareStock] = useState(false);
  const [deltaIds, setDeltaIds] = useState<readonly string[] | null>(null);
  const hydrated = useRef(false);
  const pnlHomeRef = useRef<ChartView | null>(null);
  const deltaHomeRef = useRef<ChartView | null>(null);
  const pnlLimitsRef = useRef<ChartView | null>(null);
  const deltaLimitsRef = useRef<ChartView | null>(null);
  const pendingDeltaX = useRef<{ xMin: number; xMax: number } | null>(null);
  const linkPlotsRef = useRef(true);
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
    setDeltaIds((prev) => {
      if (linkPlotsRef.current || prev == null) return prev;
      const kept = prev.filter((id) => structures.includes(id));
      const newcomers = structures.filter((id) => !prevStructures.includes(id) && !kept.includes(id));
      return [...kept, ...newcomers];
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

  const paintCurves = useCallback(
    (sel: ChartSelection) => {
      const painted = sel.mode === "structure" ? combinedDateCurves(evaluation, sel) : visibleCurves(evaluation, sel);
      if (sel.mode === "waterfall") {
        return painted.map((curve) => {
          const expiry = evaluation.horizons.some((horizon) => horizon.id === curve.horizonId && horizon.settlement);
          return {
            ...curve,
            width: chrome.thickness + (expiry ? 1 : 0),
            dash: chrome.stroke === "dashed" && !expiry ? (curve.dash ?? "6 3") : curve.dash,
          };
        });
      }
      return applyCurveLook(painted, { colorMode: chrome.colorMode, stroke: chrome.stroke, thickness: chrome.thickness }, evaluation);
    },
    [evaluation, chrome.colorMode, chrome.stroke, chrome.thickness],
  );
  const pnlCurves = useMemo(() => paintCurves(selection), [paintCurves, selection]);
  const activeDelta = linkPlots || deltaIds == null ? selection.structureIds : deltaIds;
  const deltaSelection = useMemo(
    () => (linkPlots ? selection : { ...selection, structureIds: activeDelta }),
    [linkPlots, selection, activeDelta],
  );
  const deltaCurves = useMemo(() => paintCurves(deltaSelection), [paintCurves, deltaSelection]);
  const tileIds = evaluation.structures.map((row) => row.spec.id);
  const commitPlot = useCallback(
    (action: PlotAction) => {
      const next = applyPlotAction({ link: linkPlots, pnl: selection.structureIds, delta: activeDelta }, action);
      setLinkPlots(next.link);
      setDeltaIds(next.link ? null : next.delta);
      if (next.pnl.join("\n") === selection.structureIds.join("\n")) return;
      let updated = setStructures(selection, [...next.pnl]);
      if (action.kind === "toggle" && !selection.structureIds.includes(action.id) && next.pnl.includes(action.id)) {
        updated = { ...updated, focusStructureId: action.id };
      }
      setSelection(updated);
      persist(updated, chrome);
    },
    [linkPlots, selection, activeDelta, chrome],
  );
  const commitRef = useRef(commitPlot);
  useLayoutEffect(() => {
    linkPlotsRef.current = linkPlots;
    commitRef.current = commitPlot;
  }, [linkPlots, commitPlot]);
  useEffect(() => {
    onDeltaPlot?.(activeDelta);
  }, [onDeltaPlot, activeDelta]);
  useEffect(() => {
    bindDeltaToggle?.((id) => commitRef.current({ kind: "toggle", chart: "delta", id }));
  }, [bindDeltaToggle]);
  const onHome = useCallback((next: ChartView, limits: ChartView) => {
    pnlLimitsRef.current = limits;
    setPnlLimits((prev) => (sameView(prev, limits) ? prev : limits));
    setHome((prev) => (sameView(prev, next) ? prev : next));
  }, [setHome, setPnlLimits]);
  const onDeltaHome = useCallback((next: ChartView, limits: ChartView) => {
    deltaLimitsRef.current = limits;
    setDeltaHome((prev) => (sameView(prev, next) ? prev : next));
    const keep = pendingDeltaX.current;
    if (!keep) return;
    pendingDeltaX.current = null;
    setDeltaView((prev) => {
      const merged = sharePriceWindow({ ...next, xMin: keep.xMin, xMax: keep.xMax }, next);
      return sameView(prev, merged) ? prev : merged;
    });
  }, [setDeltaHome, setDeltaView]);
  const showFullRange = useCallback((source: "pnl" | "delta") => {
    const pnl = pnlLimitsRef.current;
    const delta = deltaLimitsRef.current;
    if (!linkX) {
      if (source === "pnl" && pnl) setView((prev) => (sameView(prev, pnl) ? prev : pnl));
      if (source === "delta" && delta) setDeltaView((prev) => (sameView(prev, delta) ? prev : delta));
      return;
    }
    if (pnl) setView((prev) => (sameView(prev, pnl) ? prev : pnl));
    if (delta) setDeltaView((prev) => (sameView(prev, delta) ? prev : delta));
  }, [linkX, setView, setDeltaView]);
  useLayoutEffect(() => {
    pnlHomeRef.current = home;
    deltaHomeRef.current = deltaHome;
  }, [home, deltaHome]);
  const pushView = useCallback((source: "pnl" | "delta", next: ChartView | null) => {
    if (!linkX) {
      if (source === "pnl") setView(next);
      else setDeltaView(next);
      return;
    }
    if (next == null) {
      setView(null);
      setDeltaView(null);
      return;
    }
    setView((prev) => {
      const base = source === "pnl" ? next : (prev ?? pnlHomeRef.current);
      if (!base) return source === "pnl" ? next : prev;
      const merged = source === "pnl" ? next : sharePriceWindow(next, base);
      return sameView(prev, merged) ? prev : merged;
    });
    setDeltaView((prev) => {
      const base = source === "delta" ? next : (prev ?? deltaHomeRef.current);
      if (!base) return source === "delta" ? next : prev;
      const merged = source === "delta" ? next : sharePriceWindow(next, base);
      return sameView(prev, merged) ? prev : merged;
    });
  }, [linkX, setView, setDeltaView]);
  const deltaRows = useMemo(() => {
    const spots = evaluation.axis.length > 0 ? [...evaluation.axis] : [];
    return spots.map((spot) => {
      const row: ChartRow = { spot };
      for (const curve of deltaCurves) {
        const value = sampleStructureDelta(evaluation, curve.structureId, curve.horizonId, spot, deltaScale, deltaMeasure);
        if (value != null) row[curve.key] = value;
      }
      if (chrome.showStock) {
        const stock = sampleStockDelta(evaluation, spot, deltaScale, deltaMeasure);
        if (stock != null) row.stock = stock;
      }
      return row;
    });
  }, [evaluation, deltaCurves, deltaScale, deltaMeasure, chrome.showStock]);
  const stepKeys = useMemo(() => {
    const keys = new Set<string>();
    for (const curve of deltaCurves) {
      if (isExpiryCurve(evaluation, curve.structureId, curve.horizonId)) keys.add(curve.key);
    }
    return keys;
  }, [deltaCurves, evaluation]);
  const deltaGuides = useMemo(() => {
    if (!showHundred || deltaMeasure !== "delta") return [];
    const counts = priced.flatMap((row) =>
      deltaCurves.some((curve) => curve.structureId === row.spec.id) && row.sizing.status !== "needsCapitalOverride"
        ? [row.sizing.packages]
        : [],
    );
    return hundredLines(deltaScale, counts).map((line) => ({ key: `hundred-${line.label}`, y: line.y, label: line.label }));
  }, [showHundred, deltaMeasure, deltaScale, priced, deltaCurves]);
  const peakLines = useMemo(() => {
    if (!showPeak || deltaMeasure !== "delta") return [];
    const byId = new Map<string, { x: number; value: number; color: string }>();
    for (const curve of deltaCurves) {
      const peak = peakDelta(
        deltaRows.map((row) => {
          const raw = row[curve.key];
          return { spot: row.spot, value: typeof raw === "number" ? raw : null };
        }),
      );
      if (!peak) continue;
      const prev = byId.get(curve.structureId);
      if (!prev || peak.value > prev.value) byId.set(curve.structureId, { x: peak.spot, value: peak.value, color: curve.color });
    }
    return [...byId.entries()].map(([id, peak]) => {
      const name = priced.find((row) => row.spec.id === id)?.spec.label ?? "max";
      return {
        key: `peak-${id}`,
        x: peak.x,
        color: peak.color,
        label: `${name} max delta at $${peak.x.toFixed(2)}`,
      };
    });
  }, [showPeak, deltaMeasure, deltaCurves, deltaRows, priced]);
  const shown = view ?? home;
  const profit = useMemo(
    () => (evaluation.spotWindow.source === "fit" ? positiveCrossovers(evaluation, pnlCurves) : []),
    [evaluation, pnlCurves],
  );
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
    <div className="box-border w-full min-w-0 max-w-full space-y-3" data-chart-mode={selection.mode}>
      <div id="chart-display" role="group" aria-label="Chart display" className="flex flex-wrap gap-1.5">
        {CHART_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            aria-pressed={selection.mode === mode.id}
            onClick={() => {
              setView(null);
              setDeltaView(null);
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
        <Toggle on={hundredShareStock} onClick={() => setHundredShareStock((on) => !on)} label="100 shares" />
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
              setDeltaView(null);
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
              setDeltaView(null);
              commitWindow(minDraft ?? spotText(shown?.xMin ?? evaluation.spotWindow.min), maxDraft);
            }}
            className={`mt-1 block w-24 px-2 py-1 text-sm tabular-nums ${labControl}`}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setView(null);
            setDeltaView(null);
            setMinDraft(null);
            setMaxDraft(null);
            onEdit({ kind: "setWindow", window: { kind: "fit" } });
          }}
          className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
        >
          Profit crossovers
        </button>
        <Toggle
          on={linkX}
          onClick={() => {
            if (!linkX) {
              const xSource = view ?? home;
              const yTarget = deltaView ?? deltaHome;
              if (xSource && yTarget) {
                const merged = sharePriceWindow(xSource, yTarget);
                setDeltaView((prev) => (sameView(prev, merged) ? prev : merged));
              }
            }
            setLinkX((on) => !on);
          }}
          label="Link price zoom"
        />
        <Toggle
          on={linkPlots}
          onClick={() => commitPlot({ kind: "link", on: !linkPlots, universe: tileIds })}
          label="Link selection"
        />
        <p className="pb-1 text-xs text-zinc-700 dark:text-zinc-300">
          {view && shown && pnlLimits && sameView(view, pnlLimits)
            ? `Full price range ${spotText(shown.xMin)}–${spotText(shown.xMax)}.`
            : view && shown
              ? `Zoomed. Visible price ${spotText(shown.xMin)}–${spotText(shown.xMax)}.`
              : profit.length > 0
                ? "Fitted to profit-side crossovers. Reset view returns here."
                : evaluation.spotWindow.source === "fit"
                  ? "Fitted to crossovers, breakevens, strikes, and spot."
                  : "Typed spot window."}{" "}
          Spot stays on.
        </p>
        <ChartLookControls
          chrome={chrome}
          onChrome={(next) => {
            if (yAxisDiffers(chrome.yAxis, next.yAxis)) {
              setView(null);
              setDeltaView(null);
            }
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

      {pnlCurves.length === 0 && deltaCurves.length === 0 ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          {quiet.length > 0 ? "That curve stays off the chart until a package fits." : "Select a structure and a date to draw P&L."}
        </p>
      ) : (
        <div className="box-border w-full min-w-0 max-w-full space-y-4">
          <StrategyPlot
            title={chartTitle}
            metric={chartMetric}
            evaluation={evaluation}
            priced={priced}
            curves={pnlCurves}
            chrome={chrome}
            masked={masked}
            whatIfSpot={whatIfSpot}
            view={view}
            onView={(next) => pushView("pnl", next)}
            onHome={onHome}
            onFullRange={() => showFullRange("pnl")}
            profitCrossovers={profit}
            focusedKey={chrome.focusedCurveKey}
            onFocus={(key) => restyle({ ...chrome, focusedCurveKey: key })}
            useLook={useLook}
            role="pnl"
            chartSize={chartSize}
            onChartSize={setChartSize}
            stockBasis={hundredShareStock ? "hundred" : "capital"}
            header={
              <PlotChips
                chart="pnl"
                mode={selection.mode}
                structures={evaluation.structures}
                ids={selection.structureIds}
                focusId={selection.focusStructureId}
                onAction={commitPlot}
              />
            }
          />
          <StrategyPlot
            title="Position delta vs underlying price"
            metric=""
            subtitle={
              deltaMeasure === "omega"
                ? "Omega versus underlying price: model delta at each price, times that price, divided by the debit. This uses the date drawn on the chart. Peak leverage on the tile uses today's date only."
                : "Sticky entry IV on every date and price. Each date uses that structure's own time to expiry. Expiry draws each structure at its own expiry."
            }
            evaluation={evaluation}
            priced={priced}
            curves={deltaCurves}
            chrome={{ ...chrome, yAxis: deltaY, focusedCurveKey: deltaFocus }}
            masked={masked}
            whatIfSpot={whatIfSpot}
            view={deltaView}
            onView={(next) => pushView("delta", next)}
            onHome={onDeltaHome}
            onFullRange={() => showFullRange("delta")}
            profitCrossovers={profit}
            focusedKey={deltaFocus}
            onFocus={setDeltaFocus}
            useLook={useLook}
            rows={deltaRows}
            formatY={(value) => formatDeltaValue(value, deltaScale, deltaMeasure, masked)}
            tooltip={<DeltaTip formatValue={(value) => formatDeltaValue(value, deltaScale, deltaMeasure, masked)} unit={deltaUnit(deltaScale, deltaMeasure)} />}
            stepKeys={stepKeys}
            yLines={deltaGuides}
            xLines={peakLines}
            header={
              <div className="space-y-2">
              <PlotChips
                chart="delta"
                mode={selection.mode}
                structures={evaluation.structures}
                ids={activeDelta}
                focusId={selection.focusStructureId}
                onAction={commitPlot}
              />
              <DeltaScaleBar
                scale={deltaScale}
                measure={deltaMeasure}
                showHundred={showHundred}
                showPeak={showPeak}
                yAxis={deltaY}
                yMinDraft={deltaYMinDraft}
                yMaxDraft={deltaYMaxDraft}
                onScale={setDeltaScale}
                onMeasure={setDeltaMeasure}
                onHundred={() => setShowHundred((on) => !on)}
                onPeak={() => setShowPeak((on) => !on)}
                onAuto={() => {
                  if (deltaY.kind === "auto") return;
                  setDeltaY({ kind: "auto" });
                  setDeltaView((prev) => {
                    if (prev) pendingDeltaX.current = { xMin: prev.xMin, xMax: prev.xMax };
                    return null;
                  });
                }}
                onManual={() => {
                  const y = deltaHome ?? { yMin: -100, yMax: 100 };
                  setDeltaY({ kind: "manual", min: y.yMin, max: y.yMax });
                }}
                onYMin={setDeltaYMinDraft}
                onYMax={setDeltaYMaxDraft}
                onCommitY={(minText, maxText) => {
                  const min = Number(minText);
                  const max = Number(maxText);
                  if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
                    setDeltaY({ kind: "manual", min, max });
                    setDeltaView((prev) => (prev ? { ...prev, yMin: min, yMax: max } : prev));
                  }
                  setDeltaYMinDraft(null);
                  setDeltaYMaxDraft(null);
                }}
              />
              </div>
            }
            footer={
              <div className="mt-3 border-t border-zinc-700 pt-2">
                <p className="text-xs font-semibold text-zinc-300">
                  {deltaUnit(deltaScale, deltaMeasure)} if spot is {(whatIfSpot ?? evaluation.spot).toFixed(2)}
                </p>
                <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1">
                  {[...deltaCurves]
                    .map((curve) => ({
                      curve,
                      value: sampleStructureDelta(
                        evaluation,
                        curve.structureId,
                        curve.horizonId,
                        whatIfSpot ?? evaluation.spot,
                        deltaScale,
                        deltaMeasure,
                      ),
                    }))
                    .sort((a, b) => (b.value ?? Number.NEGATIVE_INFINITY) - (a.value ?? Number.NEGATIVE_INFINITY))
                    .map(({ curve, value }) => (
                      <span key={curve.key} className="text-sm font-semibold tabular-nums" style={{ color: curve.color }}>
                        {curve.name} {formatDeltaValue(value ?? undefined, deltaScale, deltaMeasure, masked)}
                      </span>
                    ))}
                </div>
              </div>
            }
            annotate={false}
            forceStrikes
            stockName="Stock"
            role="delta"
            chartSize={chartSize}
            onChartSize={setChartSize}
          />
        </div>
      )}
    </div>
  );
}


function yAxisDiffers(current: ChartChrome["yAxis"], next: ChartChrome["yAxis"]): boolean {
  if (current.kind !== next.kind) return true;
  return current.kind === "manual" && next.kind === "manual" && (current.min !== next.min || current.max !== next.max);
}


function PlotChips({
  chart,
  mode,
  structures,
  ids,
  focusId,
  onAction,
}: {
  chart: PlotChart;
  mode: ChartMode;
  structures: readonly StructureEval[];
  ids: readonly string[];
  focusId: string | null;
  onAction: (action: PlotAction) => void;
}) {
  const universe = structures.map((row) => row.spec.id);
  const noun = chart === "delta" ? "delta chart" : "P&L chart";
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-zinc-100">Plot on {noun}</span>
        <button
          type="button"
          onClick={() => onAction({ kind: "all", chart, universe })}
          className="text-xs font-semibold text-zinc-100 underline decoration-zinc-500 underline-offset-2"
        >
          Select all
        </button>
        <button type="button" onClick={() => onAction({ kind: "none", chart })} className="text-xs font-semibold text-zinc-100 underline decoration-zinc-500 underline-offset-2">
          None
        </button>
        <button
          type="button"
          onClick={() => onAction({ kind: "invert", chart, universe })}
          className="text-xs font-semibold text-zinc-100 underline decoration-zinc-500 underline-offset-2"
        >
          Invert
        </button>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {structures.map((row) => {
          const color = seriesColor(row.spec.slot);
          const on = ids.includes(row.spec.id);
          const focus = mode === "waterfall" && on && row.spec.id === focusId;
          const label = row.spec.label || "Structure";
          return (
            <button
              key={row.spec.id}
              type="button"
              aria-pressed={on}
              aria-label={`Plot ${label} on ${noun}`}
              onClick={() => onAction({ kind: "toggle", chart, id: row.spec.id })}
              className="rounded-full px-3 py-1 text-xs font-semibold"
              style={{
                backgroundColor: on ? color : "transparent",
                color: on ? "#09090b" : color,
                border: `1px solid ${color}`,
                boxShadow: focus ? `0 0 0 2px #09090b, 0 0 0 4px ${color}` : undefined,
              }}
            >
              {label}
              {focus ? " · rainbow" : ""}
            </button>
          );
        })}
      </div>
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
      <Toggle on={chrome.yAxis.kind === "auto"} onClick={() => onChrome({ ...chrome, yAxis: { kind: "auto" } })} label="P&L Y auto" />
      {chrome.yAxis.kind === "manual" ? (
        <>
          <label className={labLabel}>
            P&L Y min
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
            P&L Y max
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
          P&L Y manual
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

function deltaUnit(scale: DeltaScale, measure: DeltaMeasure): string {
  if (measure === "omega") return "omega";
  if (measure === "exposure") return "dollar exposure";
  if (measure === "cost") return "cost per delta";
  if (scale === "package") return "per package";
  if (scale === "pct") return "% of 100 shares";
  return "share-equivalents";
}

function formatDeltaValue(value: number | undefined, scale: DeltaScale, measure: DeltaMeasure, mask: boolean): string {
  if (mask) return "XXXXX";
  if (value == null || !Number.isFinite(value)) return "—";
  if (measure === "omega") return `${value.toFixed(2)}×`;
  if (measure === "exposure" || measure === "cost") return formatSignedUsd2(value);
  const digits = Math.abs(value - Math.round(value)) < 0.05 ? 0 : 1;
  const body = formatNum(value, digits);
  return scale === "pct" ? `${body}%` : body;
}

function DeltaTip({
  active,
  payload,
  formatValue,
  unit,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: ChartRow }>;
  formatValue: (value: number | undefined) => string;
  unit: string;
}) {
  if (!active || !payload?.length) return null;
  const spot = payload[0]?.payload?.spot;
  const rows = [...payload].sort((a, b) => {
    const left = typeof a.value === "number" && Number.isFinite(a.value) ? a.value : Number.NEGATIVE_INFINITY;
    const right = typeof b.value === "number" && Number.isFinite(b.value) ? b.value : Number.NEGATIVE_INFINITY;
    return right - left;
  });
  return (
    <div className="max-w-sm rounded-md border border-zinc-500 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 shadow-lg">
      <div className="tabular-nums text-zinc-50">
        Spot {spot != null ? spot.toFixed(2) : ""} · {unit}
      </div>
      {rows.map((item) => (
        <div key={String(item.name)} className="tabular-nums" style={{ color: item.color }}>
          {item.name} {formatValue(typeof item.value === "number" ? item.value : undefined)}
        </div>
      ))}
    </div>
  );
}

function DarkChip({ on, onClick, label, title }: { on: boolean; onClick: () => void; label: string; title?: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
      title={title}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        on ? "bg-zinc-100 text-zinc-950" : "border border-zinc-500 text-zinc-100 hover:border-zinc-200"
      }`}
    >
      {label}
    </button>
  );
}

function DeltaScaleBar({
  scale,
  measure,
  showHundred,
  showPeak,
  yAxis,
  yMinDraft,
  yMaxDraft,
  onScale,
  onMeasure,
  onHundred,
  onPeak,
  onAuto,
  onManual,
  onYMin,
  onYMax,
  onCommitY,
}: {
  scale: DeltaScale;
  measure: DeltaMeasure;
  showHundred: boolean;
  showPeak: boolean;
  yAxis: ChartChrome["yAxis"];
  yMinDraft: string | null;
  yMaxDraft: string | null;
  onScale: (scale: DeltaScale) => void;
  onMeasure: (measure: DeltaMeasure) => void;
  onHundred: () => void;
  onPeak: () => void;
  onAuto: () => void;
  onManual: () => void;
  onYMin: (value: string | null) => void;
  onYMax: (value: string | null) => void;
  onCommitY: (minText: string, maxText: string) => void;
}) {
  return (
    <div className="flex flex-wrap items-end gap-2">
      <div className="flex gap-1" role="group" aria-label="Delta scale">
        <DarkChip on={scale === "shares"} onClick={() => onScale("shares")} label="Shares" />
        <DarkChip on={scale === "package"} onClick={() => onScale("package")} label="Per package" />
        <DarkChip on={scale === "pct"} onClick={() => onScale("pct")} label="% of 100" />
      </div>
      <div className="flex gap-1" role="group" aria-label="Delta measure">
        <DarkChip on={measure === "delta"} onClick={() => onMeasure("delta")} label="Delta" />
        <DarkChip on={measure === "exposure"} onClick={() => onMeasure("exposure")} label="Dollar exposure" />
        <DarkChip on={measure === "cost"} onClick={() => onMeasure("cost")} label="Cost per delta" />
        <DarkChip
          on={measure === "omega"}
          onClick={() => onMeasure("omega")}
          label="Omega"
          title="Omega versus underlying price: model delta at each price, times that price, divided by the debit. Uses the date drawn on this chart."
        />
      </div>
      <DarkChip on={showHundred} onClick={onHundred} label="100 line" />
      <DarkChip on={showPeak} onClick={onPeak} label="Max delta" />
      <DarkChip on={yAxis.kind === "auto"} onClick={onAuto} label="Delta Y auto" />
      {yAxis.kind === "manual" ? (
        <>
          <label className="text-xs font-medium text-zinc-300">
            Delta Y min
            <input
              aria-label="Delta Y axis minimum"
              type="number"
              value={yMinDraft ?? String(yAxis.min)}
              onChange={(event) => onYMin(event.target.value)}
              onBlur={() => {
                if (yMinDraft == null) return;
                onCommitY(yMinDraft, yMaxDraft ?? String(yAxis.max));
              }}
              className={`mt-1 block w-24 px-2 py-1 text-sm tabular-nums ${labControl}`}
            />
          </label>
          <label className="text-xs font-medium text-zinc-300">
            Delta Y max
            <input
              aria-label="Delta Y axis maximum"
              type="number"
              value={yMaxDraft ?? String(yAxis.max)}
              onChange={(event) => onYMax(event.target.value)}
              onBlur={() => {
                if (yMaxDraft == null) return;
                onCommitY(yMinDraft ?? String(yAxis.min), yMaxDraft);
              }}
              className={`mt-1 block w-24 px-2 py-1 text-sm tabular-nums ${labControl}`}
            />
          </label>
        </>
      ) : (
        <button type="button" onClick={onManual} className="text-xs font-semibold text-zinc-100 underline decoration-zinc-500 underline-offset-2">
          Delta Y manual
        </button>
      )}
    </div>
  );
}

