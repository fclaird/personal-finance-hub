"use client";

import { Fragment, useState } from "react";
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
  capitalExpiryPnl,
  crossoverText,
  type ExpiryBoard,
  type ExpiryCrossover,
  type ExpiryZone,
  type LabEdit,
  type LabEvaluation,
  type ModelCrossover,
  type PricedStructure,
} from "@/lib/strategyLab/lab";
import { LAB_PALETTE, labControl, labLabel } from "@/lib/strategyLab/palette";

type Row = { spot: number; stock?: number } & Record<string, number | undefined>;

function money(n: number | undefined, mask: boolean): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatSignedUsd2(n, { mask });
}

function colorOf(evaluation: LabEvaluation, id: string): string {
  if (id === "stock") return LAB_PALETTE.stock;
  const row = evaluation.structures.find((item) => item.spec.id === id);
  return LAB_PALETTE.series[row?.spec.slot ?? 0] ?? LAB_PALETTE.series[0];
}

function ChartTip({
  active,
  payload,
  mask,
}: {
  active?: boolean;
  payload?: Array<{ name?: string; value?: number; color?: string; payload?: Row }>;
  mask: boolean;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]?.payload;
  return (
    <div className="rounded-md border border-zinc-500 bg-zinc-900 px-2.5 py-1.5 text-xs text-zinc-100 shadow-lg">
      <div className="tabular-nums text-zinc-100">Spot {row ? row.spot.toFixed(2) : ""}</div>
      {payload.map((item) => (
        <div key={String(item.name)} className="tabular-nums" style={{ color: item.color }}>
          {item.name} {money(typeof item.value === "number" ? item.value : undefined, mask)}
        </div>
      ))}
    </div>
  );
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

function stockPnl(evaluation: LabEvaluation, spot: number): number {
  const capital = evaluation.basis.kind === "equalCapital" ? evaluation.basis.capital : evaluation.spot * 100;
  return ((spot - evaluation.spot) / evaluation.spot) * capital;
}

function boardFor(evaluation: LabEvaluation, horizonId: string, series: readonly PricedStructure[]): ExpiryBoard | null {
  const horizon = evaluation.horizons.find((item) => item.id === horizonId);
  if (!horizon?.settlement) return null;
  const ids = new Set(series.map((row) => row.spec.id));
  return (
    evaluation.expiryBoards.find((board) => {
      const options = board.structureIds.filter((id) => id !== "stock");
      return board.exact && options.length >= 2 && options.every((id) => ids.has(id)) && [...ids].every((id) => options.includes(id));
    }) ?? null
  );
}

function zoneLabel(zone: ExpiryZone): string {
  if (zone.allLose) return "All lose";
  if (zone.tied) return "Tie";
  if (zone.plateau) return `${zone.bestLabel} max`;
  return zone.bestLabel;
}

function labelRank(crossovers: readonly { spot: number }[], index: number): number {
  let rank = 0;
  for (let i = index - 1; i >= 0; i--) {
    if (crossovers[index]!.spot - crossovers[i]!.spot > 30) break;
    rank += 1;
  }
  return rank % 4;
}

function samplePnl(points: readonly { spot: number; pnl: number }[], spot: number): number | null {
  if (points.length === 0) return null;
  if (spot <= points[0]!.spot) return points[0]!.pnl;
  const last = points[points.length - 1]!;
  if (spot >= last.spot) return last.pnl;
  for (let i = 0; i < points.length - 1; i++) {
    const left = points[i]!;
    const right = points[i + 1]!;
    if (spot < left.spot || spot > right.spot) continue;
    const span = right.spot - left.spot;
    const t = span === 0 ? 0 : (spot - left.spot) / span;
    return left.pnl + (right.pnl - left.pnl) * t;
  }
  return null;
}

function Marks({
  evaluation,
  crossovers,
  zones,
  xLo,
  xHi,
  model,
  whatIf,
  dotY,
}: {
  evaluation: LabEvaluation;
  crossovers: readonly ExpiryCrossover[];
  zones: readonly ExpiryZone[];
  xLo: number;
  xHi: number;
  model: boolean;
  whatIf: number | null;
  dotY: (id: string, spot: number) => number | null;
}) {
  const visible = crossovers.filter((crossover) => crossover.spot >= xLo && crossover.spot <= xHi);
  return (
    <>
      {zones.map((zone) => {
        const x1 = Math.max(zone.lo, xLo);
        const x2 = Math.min(zone.hi ?? xHi, xHi);
        if (!(x2 > x1)) return null;
        return (
          <ReferenceArea
            key={`${zone.lo}-${zone.hi ?? "inf"}`}
            x1={x1}
            x2={x2}
            fill={colorOf(evaluation, zone.bestId)}
            fillOpacity={LAB_PALETTE.zoneOpacity}
            strokeOpacity={0}
            label={{ value: zoneLabel(zone), position: "center", fill: colorOf(evaluation, zone.bestId), fontSize: 13, fontWeight: 700 }}
          />
        );
      })}
      {visible.map((crossover, index) => {
        const y = dotY(crossover.overtakesId, crossover.spot);
        const text = model ? `${crossoverText(crossover)} (model)` : crossoverText(crossover);
        const fill = colorOf(evaluation, crossover.overtakesId);
        const rank = labelRank(visible, index);
        return (
          <Fragment key={`${crossover.overtakesId}-${crossover.overtakenId}-${crossover.spot}`}>
            <ReferenceLine
              x={crossover.spot}
              stroke={fill}
              strokeWidth={2}
              strokeDasharray="4 3"
              ifOverflow="visible"
              label={(props: { viewBox?: { x?: number; y?: number } }) => {
                const x = (props.viewBox?.x ?? 0) + 3;
                const top = (props.viewBox?.y ?? 0) + 14 + rank * 12;
                return (
                  <text x={x} y={top} fill={fill} fontSize={12} fontWeight={600} transform={`rotate(90 ${x} ${top})`}>
                    {text}
                  </text>
                );
              }}
            />
            {y != null ? <ReferenceDot x={crossover.spot} y={y} r={5} fill={fill} stroke={LAB_PALETTE.dotStroke} strokeWidth={1.5} /> : null}
          </Fragment>
        );
      })}
      {whatIf != null && whatIf >= xLo && whatIf <= xHi ? (
        <ReferenceLine x={whatIf} stroke={LAB_PALETTE.whatIf} strokeWidth={2} strokeDasharray="2 2" label={{ value: "What-if", fill: LAB_PALETTE.whatIf, fontSize: 12, position: "insideBottomRight" }} />
      ) : null}
    </>
  );
}

function shortHorizon(label: string): string {
  return label.split(" · ")[0] ?? label;
}

function spotText(n: number): string {
  return String(Math.round(n * 100) / 100);
}

function pnlAt(points: readonly { spot: number; pnl: number }[] | undefined, spot: number): number | undefined {
  return points?.find((point) => point.spot === spot)?.pnl;
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
  const [view, setView] = useState<"grid" | "overlay">("grid");
  const [minDraft, setMinDraft] = useState<string | null>(null);
  const [maxDraft, setMaxDraft] = useState<string | null>(null);
  const priced = evaluation.structures.filter((s): s is PricedStructure => s.status === "priced" && s.curves.length > 0);
  const xLo = evaluation.spotWindow.min;
  const xHi = evaluation.spotWindow.max;
  const inside = (spot: number) => spot >= xLo - 1e-8 && spot <= xHi + 1e-8;
  const sharedValues: number[] = [];
  for (const structure of priced) {
    for (const curve of structure.curves) {
      for (const point of curve.points) if (inside(point.spot)) sharedValues.push(point.pnl);
    }
  }
  for (const series of evaluation.stock) {
    for (const point of series.points) if (inside(point.spot)) sharedValues.push(point.pnl);
  }
  for (const board of evaluation.expiryBoards) {
    for (const structure of priced) {
      if (!board.structureIds.includes(structure.spec.id)) continue;
      for (const spot of [xLo, xHi, ...board.crossovers.map((crossover) => crossover.spot)]) {
        if (!inside(spot)) continue;
        const pnl = capitalExpiryPnl(structure, spot);
        if (pnl != null) sharedValues.push(pnl);
      }
    }
  }
  const sharedAxis = yExtent(sharedValues);
  if (!sharedAxis || priced.length === 0) {
    return <p className="text-sm text-zinc-500">Add a structure to draw P&amp;L by horizon.</p>;
  }

  const panels = evaluation.horizons.flatMap((horizon) => {
    const series = priced.filter((structure) => structure.curves.some((curve) => curve.horizonId === horizon.id));
    if (series.length === 0) return [];
    const board = boardFor(evaluation, horizon.id, series);
    const stock = evaluation.stock.find((item) => item.horizonId === horizon.id);
    const spots = board
      ? extendedSpots(xLo, xHi, board, evaluation.spot)
      : (series[0]!.curves.find((curve) => curve.horizonId === horizon.id)?.points.map((point) => point.spot).filter(inside) ?? []);
    const rows: Row[] = spots.map((spot) => {
      const row: Row = { spot };
      for (const structure of series) {
        if (board) row[structure.spec.id] = capitalExpiryPnl(structure, spot) ?? undefined;
        else row[structure.spec.id] = pnlAt(structure.curves.find((curve) => curve.horizonId === horizon.id)?.points, spot);
      }
      if (stock) row.stock = board ? stockPnl(evaluation, spot) : pnlAt(stock.points, spot);
      return row;
    });
    const modelMarks: ModelCrossover[] = board ? [] : evaluation.modelCrossovers.filter((item) => item.horizonId === horizon.id);
    const dotY = (id: string, spot: number) => {
      if (id === "stock") return stockPnl(evaluation, spot);
      const row = series.find((structure) => structure.spec.id === id);
      if (!row) return null;
      if (board) return capitalExpiryPnl(row, spot);
      const curve = row.curves.find((item) => item.horizonId === horizon.id);
      return curve ? samplePnl(curve.points, spot) : null;
    };
    return [{ horizon, series, board, stock, rows, modelMarks, dotY }];
  });

  const commitWindow = (minText: string, maxText: string) => {
    const min = Number(minText);
    const max = Number(maxText);
    if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
      onEdit({ kind: "setWindow", window: { kind: "manual", min, max } });
    }
    setMinDraft(null);
    setMaxDraft(null);
  };

  const overlayRows = (() => {
    const spots = priced[0]!.curves[0]?.points.map((point) => point.spot).filter(inside) ?? [];
    return spots.map((spot) => {
      const row: Row = { spot };
      for (const panel of panels) {
        for (const structure of panel.series) {
          const key = `${structure.spec.id}@@${panel.horizon.id}`;
          if (panel.board) row[key] = capitalExpiryPnl(structure, spot) ?? undefined;
          else row[key] = pnlAt(structure.curves.find((curve) => curve.horizonId === panel.horizon.id)?.points, spot);
        }
      }
      const expiry = panels.find((panel) => panel.board);
      if (expiry?.stock) row.stock = stockPnl(evaluation, spot);
      return row;
    });
  })();
  const expiryPanel = panels.find((panel) => panel.board);

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex rounded-full border border-zinc-400 p-0.5">
          <button
            type="button"
            aria-pressed={view === "grid"}
            onClick={() => setView("grid")}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${view === "grid" ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950" : "text-zinc-700 dark:text-zinc-200"}`}
          >
            Grid
          </button>
          <button
            type="button"
            aria-pressed={view === "overlay"}
            onClick={() => setView("overlay")}
            className={`rounded-full px-3 py-1 text-xs font-semibold ${view === "overlay" ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950" : "text-zinc-700 dark:text-zinc-200"}`}
          >
            Overlay
          </button>
        </div>
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
          {evaluation.spotWindow.source === "fit" ? "Fitted to crossovers, breakevens, strikes, and spot." : "Typed spot window."} Panels share both axes.
        </p>
      </div>
      <div className="flex flex-wrap gap-3">
        {priced.map((structure) => (
          <span key={structure.spec.id} className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-900 dark:text-zinc-100">
            <span
              className="inline-block h-2.5 w-6 rounded-sm"
              style={{ backgroundColor: LAB_PALETTE.series[structure.spec.slot] ?? LAB_PALETTE.series[0] }}
            />
            {structure.spec.label}
          </span>
        ))}
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-700 dark:text-zinc-300">
          <span className="inline-block h-0.5 w-6 border-t-2 border-dashed" style={{ borderColor: LAB_PALETTE.stock }} />
          Stock
        </span>
      </div>

      {view === "overlay" ? (
        <section id="h-overlay" className="rounded-xl border border-zinc-600 bg-zinc-950 p-3 text-zinc-100">
          <h3 className="mb-1 text-sm font-semibold text-zinc-50">Quarters overlaid</h3>
          <p className="mb-2 text-xs text-zinc-300">
            Each structure keeps its chart color. Earlier quarters are dashed and expiry is the solid line. Expiry crossover labels are exact. Marks on the other dates stay on the grid and are labeled model-based.
          </p>
          <div className="mb-2 flex flex-wrap gap-3">
            {priced.map((structure) => (
              <span key={structure.spec.id} className="inline-flex items-center gap-1.5 text-xs font-semibold text-zinc-100">
                <span
                  className="inline-block h-2.5 w-6 rounded-sm"
                  style={{ backgroundColor: LAB_PALETTE.series[structure.spec.slot] ?? LAB_PALETTE.series[0] }}
                />
                {structure.spec.label}
              </span>
            ))}
          </div>
          <div className="h-[32rem] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={overlayRows} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                <CartesianGrid strokeDasharray="3 3" stroke={LAB_PALETTE.grid} />
                <XAxis
                  dataKey="spot"
                  type="number"
                  domain={[xLo, xHi]}
                  tickFormatter={(v: number) => v.toFixed(0)}
                  allowDataOverflow
                  tick={{ fill: LAB_PALETTE.axis, fontSize: 12 }}
                  axisLine={{ stroke: LAB_PALETTE.axisLine }}
                  tickLine={{ stroke: LAB_PALETTE.axisLine }}
                />
                <YAxis
                  domain={sharedAxis.domain}
                  ticks={sharedAxis.ticks}
                  tickFormatter={(v: number) => (masked ? "XXXXX" : formatSignedUsd2(v))}
                  width={88}
                  allowDataOverflow
                  tick={{ fill: LAB_PALETTE.axis, fontSize: 12 }}
                  axisLine={{ stroke: LAB_PALETTE.axisLine }}
                  tickLine={{ stroke: LAB_PALETTE.axisLine }}
                />
                <Tooltip content={<ChartTip mask={masked} />} />
                {expiryPanel?.board ? (
                  <Marks
                    evaluation={evaluation}
                    crossovers={expiryPanel.board.crossovers}
                    zones={expiryPanel.board.zones}
                    xLo={xLo}
                    xHi={xHi}
                    model={false}
                    whatIf={whatIfSpot}
                    dotY={expiryPanel.dotY}
                  />
                ) : null}
                <ReferenceLine y={0} stroke={LAB_PALETTE.zero} strokeWidth={1.5} />
                <ReferenceLine x={evaluation.spot} stroke={LAB_PALETTE.spot} strokeWidth={2} strokeDasharray="5 5" />
                {panels.map((panel, index) =>
                  panel.series.map((structure) => (
                    <Line
                      key={`${structure.spec.id}-${panel.horizon.id}`}
                      type="linear"
                      dataKey={`${structure.spec.id}@@${panel.horizon.id}`}
                      name={`${structure.spec.label} ${shortHorizon(panel.horizon.label)}`}
                      stroke={LAB_PALETTE.series[structure.spec.slot] ?? LAB_PALETTE.series[0]}
                      strokeDasharray={panel.board ? undefined : overlayDash(index)}
                      strokeOpacity={panel.board ? 1 : 0.85}
                      legendType="none"
                      dot={false}
                      strokeWidth={panel.board ? LAB_PALETTE.line : 2}
                      isAnimationActive={false}
                    />
                  )),
                )}
                {expiryPanel?.stock ? (
                  <Line
                    type="linear"
                    dataKey="stock"
                    name="Stock"
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
        </section>
      ) : (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2 xl:grid-cols-3">
          {panels.map((panel) => {
            const shorts = [...new Set(panel.series.flatMap((structure) => structure.legs.filter((leg) => leg.ratio < 0).map((leg) => leg.strike)))];
            const tall = panel.board != null;
            return (
              <section
                id={`h-${panel.horizon.id.replace(/[^a-zA-Z0-9-]/g, "-")}`}
                key={panel.horizon.id}
                className={`min-w-0 rounded-xl border border-zinc-600 bg-zinc-950 p-2 text-zinc-100 ${tall ? "md:col-span-2 xl:col-span-3" : ""}`}
              >
                <h3 className="mb-1 text-xs font-semibold text-zinc-50">{panel.horizon.label}</h3>
                {panel.board ? (
                  <p className="mb-1 text-[11px] text-zinc-300">{panel.board.metric}. Shaded band is the leader. Crossovers are exact expiry math.</p>
                ) : panel.modelMarks.length > 0 ? (
                  <p className="mb-1 text-[11px] text-zinc-300">Crossover marks are numerical and model-based. They are not exact.</p>
                ) : null}
                <div className={tall ? "h-[22rem] w-full" : "h-52 w-full"}>
                  <ResponsiveContainer width="100%" height="100%">
                    <ComposedChart data={panel.rows} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" stroke={LAB_PALETTE.grid} />
                      <XAxis
                        dataKey="spot"
                        type="number"
                        domain={[xLo, xHi]}
                        tickFormatter={(v: number) => v.toFixed(0)}
                        allowDataOverflow
                        tick={{ fill: LAB_PALETTE.axis, fontSize: tall ? 12 : 10 }}
                        axisLine={{ stroke: LAB_PALETTE.axisLine }}
                        tickLine={{ stroke: LAB_PALETTE.axisLine }}
                      />
                      <YAxis
                        domain={sharedAxis.domain}
                        ticks={sharedAxis.ticks}
                        tickFormatter={(v: number) => (masked ? "XXXXX" : formatSignedUsd2(v))}
                        width={tall ? 80 : 64}
                        allowDataOverflow
                        tick={{ fill: LAB_PALETTE.axis, fontSize: tall ? 11 : 9 }}
                        axisLine={{ stroke: LAB_PALETTE.axisLine }}
                        tickLine={{ stroke: LAB_PALETTE.axisLine }}
                      />
                      <Tooltip content={<ChartTip mask={masked} />} />
                      {panel.board ? (
                        <Marks
                          evaluation={evaluation}
                          crossovers={panel.board.crossovers}
                          zones={panel.board.zones}
                          xLo={xLo}
                          xHi={xHi}
                          model={false}
                          whatIf={whatIfSpot}
                          dotY={panel.dotY}
                        />
                      ) : (
                        <Marks
                          evaluation={evaluation}
                          crossovers={panel.modelMarks}
                          zones={[]}
                          xLo={xLo}
                          xHi={xHi}
                          model
                          whatIf={null}
                          dotY={panel.dotY}
                        />
                      )}
                      <ReferenceLine y={0} stroke={LAB_PALETTE.zero} strokeWidth={1.5} />
                      <ReferenceLine x={evaluation.spot} stroke={LAB_PALETTE.spot} strokeWidth={1.5} strokeDasharray="5 5" />
                      {shorts.map((strike) => (
                        <ReferenceLine key={strike} x={strike} stroke={LAB_PALETTE.strike} strokeWidth={1} strokeDasharray="3 3" />
                      ))}
                      {panel.series.map((structure) => (
                        <Line
                          key={structure.spec.id}
                          type="linear"
                          dataKey={structure.spec.id}
                          name={structure.spec.label}
                          stroke={LAB_PALETTE.series[structure.spec.slot] ?? LAB_PALETTE.series[0]}
                          dot={false}
                          strokeWidth={LAB_PALETTE.line}
                          isAnimationActive={false}
                        />
                      ))}
                      {panel.stock ? (
                        <Line
                          type="linear"
                          dataKey="stock"
                          name="Stock"
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
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}

function overlayDash(index: number): string {
  const dashes = ["2 2", "6 3", "1 4", "8 3", "4 2", "3 3", "10 4", "5 2", "2 5", "7 2"];
  return dashes[index % dashes.length] ?? "4 3";
}

function extendedSpots(lo: number, hi: number, board: ExpiryBoard, spot: number): number[] {
  const extras = [
    spot,
    ...board.crossovers.map((crossover) => crossover.spot),
    ...board.zones.flatMap((zone) => [zone.lo, zone.hi ?? hi]),
  ];
  const n = 181;
  const spots = new Set<number>();
  for (let i = 0; i < n; i++) spots.add(lo + ((hi - lo) * i) / (n - 1));
  for (const extra of extras) if (extra >= lo && extra <= hi) spots.add(extra);
  return [...spots].sort((a, b) => a - b);
}
