"use client";

import {
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatSignedUsd2 } from "@/lib/format";
import type { LabEvaluation, PricedStructure } from "@/lib/strategyLab/lab";

const SERIES = ["#059669", "#0891b2", "#d97706", "#7c3aed"];
const STOCK = "#71717a";
const SPOT = "#16a34a";
const SHORT = "#7c3aed";

type Row = { spot: number; stock?: number } & Record<string, number | undefined>;

function money(n: number | undefined, mask: boolean): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatSignedUsd2(n, { mask });
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

function domainOf(evaluation: LabEvaluation): [number, number] | undefined {
  const values: number[] = [];
  for (const structure of evaluation.structures) {
    if (structure.status !== "priced") continue;
    for (const curve of structure.curves) {
      for (const point of curve.points) values.push(point.pnl);
    }
  }
  for (const series of evaluation.stock) {
    for (const point of series.points) values.push(point.pnl);
  }
  if (values.length === 0) return undefined;
  const lo = Math.min(...values);
  const hi = Math.max(...values);
  const pad = Math.max((hi - lo) * 0.06, 1);
  return [lo - pad, hi + pad];
}

export function LabCharts({ evaluation, masked }: { evaluation: LabEvaluation; masked: boolean }) {
  const domain = domainOf(evaluation);
  const priced = evaluation.structures.filter((s): s is PricedStructure => s.status === "priced" && s.curves.length > 0);
  if (!domain || priced.length === 0) {
    return (
      <p className="text-sm text-zinc-500">Add a structure to draw P&amp;L by horizon.</p>
    );
  }

  return (
    <div className="space-y-6">
      {evaluation.horizons.map((horizon) => {
        const series = priced.filter((structure) =>
          structure.curves.some((curve) => curve.horizonId === horizon.id),
        );
        if (series.length === 0) return null;
        const stock = evaluation.stock.find((item) => item.horizonId === horizon.id);
        const spots = series[0]!.curves.find((curve) => curve.horizonId === horizon.id)!.points.map((p) => p.spot);
        const rows: Row[] = spots.map((spot, index) => {
          const row: Row = { spot };
          for (const structure of series) {
            const point = structure.curves.find((curve) => curve.horizonId === horizon.id)?.points[index];
            row[structure.spec.id] = point?.pnl;
          }
          if (stock) row.stock = stock.points[index]?.pnl;
          return row;
        });
        const shorts = [
          ...new Set(
            series.flatMap((structure) => structure.legs.filter((leg) => leg.ratio < 0).map((leg) => leg.strike)),
          ),
        ];
        return (
          <section id={`h-${horizon.id.replace(/[^a-zA-Z0-9-]/g, "-")}`} key={horizon.id} className="rounded-xl border border-zinc-200 bg-white p-3 dark:border-white/10 dark:bg-zinc-950">
            <h3 className="mb-2 text-sm font-semibold text-zinc-800 dark:text-zinc-100">{horizon.label}</h3>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={rows} margin={{ top: 8, right: 12, left: 8, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="#d4d4d8" />
                  <XAxis dataKey="spot" type="number" domain={["dataMin", "dataMax"]} tickFormatter={(v: number) => v.toFixed(0)} />
                  <YAxis domain={domain} tickFormatter={(v: number) => (masked ? "XXXXX" : formatSignedUsd2(v))} width={72} />
                  <Tooltip content={<ChartTip mask={masked} />} />
                  <Legend />
                  <ReferenceLine y={0} stroke="#a1a1aa" />
                  <ReferenceLine x={evaluation.spot} stroke={SPOT} strokeDasharray="5 5" label={{ value: "Spot", fill: SPOT, fontSize: 11 }} />
                  {shorts.map((strike) => (
                    <ReferenceLine key={strike} x={strike} stroke={SHORT} strokeDasharray="3 3" />
                  ))}
                  {series.map((structure) => (
                    <Line
                      key={structure.spec.id}
                      type="monotone"
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
                      type="monotone"
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
