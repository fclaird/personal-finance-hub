"use client";

import { useEffect, useRef, useState } from "react";
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
  CHART_MODES,
  crossoverCallouts,
  initialChartSelection,
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
  type ChartMode,
  type ChartSelection,
  type CurveView,
} from "@/lib/strategyLab/chartDisplay";
import {
  capitalExpiryPnl,
  type ExpiryBoard,
  type ExpiryZone,
  type LabEdit,
  type LabEvaluation,
  type PricedStructure,
} from "@/lib/strategyLab/lab";
import { LAB_PALETTE, labControl, labLabel } from "@/lib/strategyLab/palette";

type Row = { spot: number; stock?: number } & Record<string, number | undefined>;

const MODE_HINT: Record<ChartMode, string> = {
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

function yExtent(values: number[]): { domain: [number, number]; ticks: number[] } | undefined {
  if (values.length === 0) return undefined;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.06, 1);
  return niceAxis(lo - pad, hi + pad);
}

function pricedOf(evaluation: LabEvaluation): PricedStructure[] {
  return evaluation.structures.filter((row): row is PricedStructure => row.status === "priced" && row.curves.length > 0);
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
  const [showCrossovers, setShowCrossovers] = useState(true);
  const [showZones, setShowZones] = useState(false);
  const [showStrikes, setShowStrikes] = useState(false);
  const [showBreakevens, setShowBreakevens] = useState(false);
  const [minDraft, setMinDraft] = useState<string | null>(null);
  const [maxDraft, setMaxDraft] = useState<string | null>(null);
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
    setSelection((prev) =>
      reconcileChartSelection(prev, { structures, horizons }, { structures: prevStructures, horizons: prevHorizons }),
    );
  }, [structureKey, horizonKey]);

  const curves = visibleCurves(evaluation, selection);
  const selected = priced.filter((row) => selection.structureIds.includes(row.spec.id));
  const xLo = evaluation.spotWindow.min;
  const xHi = evaluation.spotWindow.max;
  const inside = (spot: number) => spot >= xLo - 1e-8 && spot <= xHi + 1e-8;
  const stockId = stockHorizonId(evaluation, curves);
  const stock = stockId ? evaluation.stock.find((series) => series.horizonId === stockId) : undefined;

  if (priced.length === 0) {
    return <p className="text-sm text-zinc-700 dark:text-zinc-300">Add a structure to draw P&amp;L by horizon.</p>;
  }

  const spots = (evaluation.axis.length > 0 ? evaluation.axis : (priced[0]?.curves[0]?.points.map((point) => point.spot) ?? [])).filter(inside);
  const rows: Row[] = spots.map((spot) => {
    const row: Row = { spot };
    for (const curve of curves) {
      const structure = priced.find((item) => item.spec.id === curve.structureId);
      const points = structure?.curves.find((item) => item.horizonId === curve.horizonId)?.points;
      const pnl = points ? samplePnl(points, spot) : null;
      if (pnl != null) row[curve.key] = pnl;
    }
    if (stock) {
      const pnl = samplePnl(stock.points, spot);
      if (pnl != null) row.stock = pnl;
    }
    return row;
  });

  const yValues: number[] = [];
  for (const row of rows) {
    for (const curve of curves) {
      const value = row[curve.key];
      if (typeof value === "number") yValues.push(value);
    }
    if (typeof row.stock === "number") yValues.push(row.stock);
  }
  const yAxis = yExtent(yValues);
  const callouts = showCrossovers ? crossoverCallouts(evaluation, curves, { min: xLo, max: xHi }) : [];
  const zones = showZones ? zoneBands(evaluation, curves, xLo, xHi) : [];
  const dateChoices = [...evaluation.horizons].sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : a.settlement ? 1 : -1));
  const multiDates = selection.mode === "quarters" || selection.mode === "custom";
  const singleDate = selection.mode === "span" || selection.mode === "dateOverlay";
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

  const readoutSpot = whatIfSpot ?? evaluation.spot;
  const strikeSpots = showStrikes
    ? [...new Set(selected.flatMap((row) => row.legs.map((leg) => leg.strike)))].filter(inside).sort((a, b) => a - b)
    : [];
  const breakevens = showBreakevens
    ? selected.flatMap((row) => row.risk.breakevens.filter(inside).map((spot) => ({ spot, id: row.spec.id, color: seriesColor(row.spec.slot) })))
    : [];

  return (
    <div className="relative left-1/2 w-screen max-w-[100vw] -translate-x-1/2 space-y-3 px-4 sm:px-6" data-chart-mode={selection.mode}>
      <div id="chart-display" role="group" aria-label="Chart display" className="flex flex-wrap gap-1.5">
        {CHART_MODES.map((mode) => (
          <button
            key={mode.id}
            type="button"
            aria-pressed={selection.mode === mode.id}
            onClick={() => setSelection((prev) => setChartMode(prev, mode.id))}
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
        onToggle={(id) => setSelection((prev) => toggleStructure(prev, id))}
        onSet={(ids) => setSelection((prev) => setStructures(prev, ids))}
      />

      {multiDates || (singleDate && singleChoices.length > 0) ? (
        <DatePicker
          mode={selection.mode}
          horizons={singleDate ? singleChoices : dateChoices}
          selection={selection}
          multi={multiDates}
          onToggle={(id) => setSelection((prev) => toggleHorizon(prev, id))}
          onSet={(ids) => setSelection((prev) => setHorizons(prev, ids))}
          onFocus={(id) => setSelection((prev) => setFocusHorizon(prev, id))}
        />
      ) : null}

      <div className="flex flex-wrap items-end gap-2">
        <Toggle on={showCrossovers} onClick={() => setShowCrossovers((value) => !value)} label="Crossovers" />
        <Toggle on={showZones} onClick={() => setShowZones((value) => !value)} label="Zones" />
        <Toggle on={showStrikes} onClick={() => setShowStrikes((value) => !value)} label="Strikes" />
        <Toggle on={showBreakevens} onClick={() => setShowBreakevens((value) => !value)} label="Breakevens" />
        <label className={labLabel}>
          Min spot
          <input
            aria-label="Spot window minimum"
            type="number"
            step="1"
            value={minDraft ?? spotText(evaluation.spotWindow.min)}
            onChange={(event) => setMinDraft(event.target.value)}
            onBlur={() => {
              if (minDraft == null) return;
              commitWindow(minDraft, maxDraft ?? spotText(evaluation.spotWindow.max));
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
            value={maxDraft ?? spotText(evaluation.spotWindow.max)}
            onChange={(event) => setMaxDraft(event.target.value)}
            onBlur={() => {
              if (maxDraft == null) return;
              commitWindow(minDraft ?? spotText(evaluation.spotWindow.min), maxDraft);
            }}
            className={`mt-1 block w-24 px-2 py-1 text-sm tabular-nums ${labControl}`}
          />
        </label>
        <button
          type="button"
          onClick={() => {
            setMinDraft(null);
            setMaxDraft(null);
            onEdit({ kind: "setWindow", window: { kind: "fit" } });
          }}
          className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
        >
          Fit all crossovers
        </button>
        <p className="pb-1 text-xs text-zinc-700 dark:text-zinc-300">
          {evaluation.spotWindow.source === "fit" ? "Fitted to crossovers, breakevens, strikes, and spot." : "Typed spot window."} Spot stays on.
        </p>
      </div>

      {curves.length === 0 || !yAxis ? (
        <p className="text-sm text-zinc-700 dark:text-zinc-300">Select a structure and a date to draw P&amp;L.</p>
      ) : (
        <section className="rounded-xl border border-zinc-600 bg-zinc-950 p-3 text-zinc-100">
          <div className="h-[70vh] min-h-[36rem] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={rows} margin={{ top: 16, right: 16, left: 8, bottom: 8 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={LAB_PALETTE.grid} />
                <XAxis
                  dataKey="spot"
                  type="number"
                  domain={[xLo, xHi]}
                  tickFormatter={(value: number) => value.toFixed(0)}
                  allowDataOverflow
                  tick={{ fill: LAB_PALETTE.axis, fontSize: 13 }}
                  axisLine={{ stroke: LAB_PALETTE.axisLine }}
                  tickLine={{ stroke: LAB_PALETTE.axisLine }}
                />
                <YAxis
                  domain={yAxis.domain}
                  ticks={yAxis.ticks}
                  tickFormatter={(value: number) => (masked ? "XXXXX" : formatSignedUsd2(value))}
                  width={96}
                  allowDataOverflow
                  tick={{ fill: LAB_PALETTE.axis, fontSize: 13 }}
                  axisLine={{ stroke: LAB_PALETTE.axisLine }}
                  tickLine={{ stroke: LAB_PALETTE.axisLine }}
                />
                <Tooltip
                  content={<ChartTip mask={masked} structures={selected} />}
                  cursor={{ stroke: LAB_PALETTE.spot, strokeWidth: 1.5 }}
                />
                {zones.map((zone) => (
                  <ReferenceArea
                    key={zone.key}
                    x1={zone.x1}
                    x2={zone.x2}
                    fill={zone.color}
                    fillOpacity={LAB_PALETTE.zoneOpacity}
                    strokeOpacity={0}
                  />
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
                <ReferenceLine
                  x={evaluation.spot}
                  stroke={LAB_PALETTE.spot}
                  strokeWidth={2}
                  strokeDasharray="5 5"
                  label={{ value: "Spot", fill: LAB_PALETTE.spot, fontSize: 12, position: "insideTopRight" }}
                />
                {whatIfSpot != null && whatIfSpot >= xLo && whatIfSpot <= xHi ? (
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
          </div>

          <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1.5">
            {curves.map((curve) => (
              <span key={curve.key} className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
                <Swatch color={curve.color} width={curve.width} dash={curve.dash} />
                {curve.name}
              </span>
            ))}
            {stock ? (
              <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-300">
                <Swatch color={LAB_PALETTE.stock} width={LAB_PALETTE.stockLine} dash="6 4" />
                Stock
              </span>
            ) : null}
          </div>

          {showCrossovers ? (
            <ol className="mt-3 grid list-none gap-1.5 sm:grid-cols-2">
              {callouts.length === 0 ? (
                <li className="text-xs text-zinc-300">No crossovers on the curves in view.</li>
              ) : (
                callouts.map((callout) => {
                  const color =
                    curves.find((curve) => curve.structureId === callout.structureId && curve.horizonId === callout.horizonId)?.color ??
                    LAB_PALETTE.axis;
                  return (
                    <li key={`${callout.horizonId}-${callout.n}`} className="flex items-start gap-2 text-sm text-zinc-100">
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
              {selected.map((row) => (
                <span key={row.spec.id} className="text-sm font-semibold tabular-nums" style={{ color: seriesColor(row.spec.slot) }}>
                  {row.spec.label} {money(capitalExpiryPnl(row, readoutSpot), masked)}
                </span>
              ))}
            </div>
          </div>
        </section>
      )}
    </div>
  );
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
  onSet: (ids: string[]) => void;
  onFocus: (id: string) => void;
}) {
  const ids = horizons.map((horizon) => horizon.id);
  const label = mode === "span" ? "Middle date" : mode === "dateOverlay" ? "Date" : "Dates";
  return (
    <div className="space-y-1.5">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-xs font-semibold text-zinc-700 dark:text-zinc-300">{label}</span>
        {multi ? (
          <>
            <TextButton onClick={() => onSet(ids)}>Select all</TextButton>
            <TextButton onClick={() => onSet([])}>Clear</TextButton>
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
