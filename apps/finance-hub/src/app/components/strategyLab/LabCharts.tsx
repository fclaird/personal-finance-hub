"use client";

import { Fragment } from "react";
import {
  CartesianGrid,
  ComposedChart,
  Legend,
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
  type LabEvaluation,
  type ModelCrossover,
  type PricedStructure,
} from "@/lib/strategyLab/lab";

const SERIES = ["#059669", "#0891b2", "#d97706", "#7c3aed"];
const STOCK = "#71717a";
const SPOT = "#16a34a";
const SHORT = "#7c3aed";
const WHAT_IF = "#e11d48";

type Row = { spot: number; stock?: number } & Record<string, number | undefined>;

function money(n: number | undefined, mask: boolean): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatSignedUsd2(n, { mask });
}

function colorOf(evaluation: LabEvaluation, id: string): string {
  if (id === "stock") return STOCK;
  const row = evaluation.structures.find((item) => item.spec.id === id);
  return SERIES[row?.spec.slot ?? 0] ?? SERIES[0]!;
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
    <div className="rounded-md border border-zinc-200 bg-white px-2.5 py-1.5 text-xs shadow-lg dark:border-white/15 dark:bg-zinc-950">
      <div className="tabular-nums text-zinc-700 dark:text-zinc-200">Spot {row ? row.spot.toFixed(2) : ""}</div>
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
            fillOpacity={0.12}
            strokeOpacity={0}
            label={{ value: zoneLabel(zone), position: "center", fill: colorOf(evaluation, zone.bestId), fontSize: 12 }}
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
              strokeDasharray="3 3"
              ifOverflow="visible"
              label={(props: { viewBox?: { x?: number; y?: number } }) => {
                const x = (props.viewBox?.x ?? 0) + 3;
                const top = (props.viewBox?.y ?? 0) + 14 + rank * 12;
                return (
                  <text x={x} y={top} fill={fill} fontSize={10} transform={`rotate(90 ${x} ${top})`}>
                    {text}
                  </text>
                );
              }}
            />
            {y != null ? <ReferenceDot x={crossover.spot} y={y} r={4} fill={fill} stroke="#fff" /> : null}
          </Fragment>
        );
      })}
      {whatIf != null && whatIf >= xLo && whatIf <= xHi ? (
        <ReferenceLine x={whatIf} stroke={WHAT_IF} strokeDasharray="2 2" label={{ value: "What-if", fill: WHAT_IF, fontSize: 10, position: "insideBottomRight" }} />
      ) : null}
    </>
  );
}

export function LabCharts({
  evaluation,
  masked,
  whatIfSpot,
}: {
  evaluation: LabEvaluation;
  masked: boolean;
  whatIfSpot: number | null;
}) {
  const priced = evaluation.structures.filter((s): s is PricedStructure => s.status === "priced" && s.curves.length > 0);
  const sharedValues: number[] = [];
  for (const structure of priced) {
    for (const curve of structure.curves) {
      const horizon = evaluation.horizons.find((item) => item.id === curve.horizonId);
      if (horizon?.settlement && boardFor(evaluation, horizon.id, priced.filter((row) => row.curves.some((item) => item.horizonId === horizon.id)))) {
        continue;
      }
      for (const point of curve.points) sharedValues.push(point.pnl);
    }
  }
  for (const series of evaluation.stock) sharedValues.push(...series.points.map((point) => point.pnl));
  if (sharedValues.length === 0) {
    for (const structure of priced) {
      for (const curve of structure.curves) {
        for (const point of curve.points) sharedValues.push(point.pnl);
      }
    }
  }
  const sharedAxis = yExtent(sharedValues);
  if (!sharedAxis || priced.length === 0) {
    return <p className="text-sm text-zinc-500">Add a structure to draw P&amp;L by horizon.</p>;
  }

  return (
    <div className="space-y-6">
      {evaluation.horizons.map((horizon) => {
        const series = priced.filter((structure) => structure.curves.some((curve) => curve.horizonId === horizon.id));
        if (series.length === 0) return null;
        const board = boardFor(evaluation, horizon.id, series);
        const stock = evaluation.stock.find((item) => item.horizonId === horizon.id);
        const base = series[0]!.curves.find((curve) => curve.horizonId === horizon.id)!.points;
        const windowLo = base[0]?.spot ?? evaluation.spot;
        const windowHi = base[base.length - 1]?.spot ?? evaluation.spot;
        const crossHi = board ? Math.max(0, ...board.crossovers.map((crossover) => crossover.spot)) : 0;
        const xHi = board ? Math.max(windowHi, crossHi > windowHi ? crossHi * 1.08 : windowHi) : windowHi;
        const xLo = windowLo;
        const spots = board ? extendedSpots(xLo, xHi, board, evaluation.spot) : base.map((point) => point.spot);
        const rows: Row[] = spots.map((spot, index) => {
          const row: Row = { spot };
          for (const structure of series) {
            if (board) row[structure.spec.id] = capitalExpiryPnl(structure, spot) ?? undefined;
            else row[structure.spec.id] = structure.curves.find((curve) => curve.horizonId === horizon.id)?.points[index]?.pnl;
          }
          if (stock) row.stock = board ? stockPnl(evaluation, spot) : stock.points[index]?.pnl;
          return row;
        });
        const values = rows.flatMap((row) => series.map((structure) => row[structure.spec.id])).filter((n): n is number => typeof n === "number");
        if (stock) {
          for (const row of rows) if (typeof row.stock === "number") values.push(row.stock);
        }
        const yAxis = board ? yExtent(values) ?? sharedAxis : sharedAxis;
        const shorts = [...new Set(series.flatMap((structure) => structure.legs.filter((leg) => leg.ratio < 0).map((leg) => leg.strike)))];
        const modelMarks: ModelCrossover[] = board ? [] : evaluation.modelCrossovers.filter((item) => item.horizonId === horizon.id);
        const dotY = (id: string, spot: number) => {
          if (id === "stock") return stockPnl(evaluation, spot);
          const row = series.find((structure) => structure.spec.id === id);
          if (!row) return null;
          if (board) return capitalExpiryPnl(row, spot);
          const curve = row.curves.find((item) => item.horizonId === horizon.id);
          return curve ? samplePnl(curve.points, spot) : null;
        };
        return (
          <section id={`h-${horizon.id.replace(/[^a-zA-Z0-9-]/g, "-")}`} key={horizon.id} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-zinc-950">
            <h3 className="mb-1 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{horizon.label}</h3>
            {board ? <p className="mb-2 text-xs text-zinc-500">{board.metric}. Shaded band is the leader. Crossovers are exact expiry math.</p> : null}
            {modelMarks.length > 0 ? (
              <p className="mb-2 text-xs text-zinc-500">Crossover marks on this date are interpolated from the model curve. They are not exact.</p>
            ) : null}
            <div className={board ? "h-[28rem] w-full" : "h-72 w-full"}>
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 8, right: 16, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d4d4d8" />
                  <XAxis dataKey="spot" type="number" domain={[xLo, xHi]} tickFormatter={(v: number) => v.toFixed(0)} allowDataOverflow />
                  <YAxis
                    domain={yAxis.domain}
                    ticks={yAxis.ticks}
                    tickFormatter={(v: number) => (masked ? "XXXXX" : formatSignedUsd2(v))}
                    width={84}
                    allowDataOverflow
                  />
                  <Tooltip content={<ChartTip mask={masked} />} />
                  <Legend />
                  {board ? (
                    <Marks
                      evaluation={evaluation}
                      crossovers={board.crossovers}
                      zones={board.zones}
                      xLo={xLo}
                      xHi={xHi}
                      model={false}
                      whatIf={whatIfSpot}
                      dotY={dotY}
                    />
                  ) : (
                    <Marks
                      evaluation={evaluation}
                      crossovers={modelMarks}
                      zones={[]}
                      xLo={xLo}
                      xHi={xHi}
                      model
                      whatIf={null}
                      dotY={dotY}
                    />
                  )}
                  <ReferenceLine y={0} stroke="#a1a1aa" />
                  <ReferenceLine x={evaluation.spot} stroke={SPOT} strokeDasharray="5 5" label={{ value: "Spot", fill: SPOT, fontSize: 11 }} />
                  {shorts.map((strike) => (
                    <ReferenceLine key={strike} x={strike} stroke={SHORT} strokeDasharray="3 3" />
                  ))}
                  {series.map((structure) => (
                    <Line
                      key={structure.spec.id}
                      type="linear"
                      dataKey={structure.spec.id}
                      name={structure.spec.label}
                      stroke={SERIES[structure.spec.slot] ?? SERIES[0]}
                      dot={false}
                      strokeWidth={2}
                      isAnimationActive={false}
                    />
                  ))}
                  {stock ? (
                    <Line
                      type="linear"
                      dataKey="stock"
                      name="Stock"
                      stroke={STOCK}
                      strokeDasharray="4 4"
                      dot={false}
                      strokeWidth={1.5}
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
  );
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
