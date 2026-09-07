"use client";

import { useMemo } from "react";
import {
  Area,
  ComposedChart,
  Line,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { formatUsd2 } from "@/lib/format";
import { liveBookToRiskProfile } from "@/lib/options/liveBookToRiskProfile";
import type { RiskProfileModel } from "@/lib/options/shortStrangleRiskProfile";
import type { LiveStructureBook } from "@/lib/situations/liveStructures";

const GREEN = "#22c55e";
const RED = "#ef4444";
const CYAN = "#22d3ee";
const AMBER = "#fbbf24";
const ZERO = "#a1a1aa";

type ChartRow = {
  spot: number;
  expirationPnl: number;
  expPos: number;
  expNeg: number;
  t0Pnl: number | null;
};

function usd(n: number | null | undefined, mask: boolean): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return formatUsd2(n, { mask });
}

function Metric({
  label,
  value,
  tone,
}: {
  label: string;
  value: string;
  tone?: "pos" | "neg" | "muted";
}) {
  const cls =
    tone === "pos"
      ? "text-emerald-400"
      : tone === "neg"
        ? "text-rose-400"
        : "text-zinc-200";
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">{label}</div>
      <div className={`text-sm tabular-nums font-medium ${cls}`}>{value}</div>
    </div>
  );
}

function ChartTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: ChartRow }>;
}) {
  if (!active || !payload?.length) return null;
  const row = payload[0]!.payload;
  return (
    <div className="rounded-md border border-white/20 bg-zinc-950/95 px-2.5 py-1.5 text-xs shadow-lg">
      <div className="tabular-nums text-zinc-200">Spot {row.spot.toFixed(2)}</div>
      <div className="tabular-nums text-emerald-400">Exp {formatUsd2(row.expirationPnl)}</div>
      {row.t0Pnl != null ? (
        <div className="tabular-nums text-cyan-300">T+0 {formatUsd2(row.t0Pnl)}</div>
      ) : null}
    </div>
  );
}

function modelToRows(model: RiskProfileModel): ChartRow[] {
  // Zeros (not nulls) keep Area continuous; Line paints the full expiration curve.
  return model.points.map((p) => ({
    spot: p.spot,
    expirationPnl: p.expirationPnl,
    expPos: p.expirationPnl >= 0 ? p.expirationPnl : 0,
    expNeg: p.expirationPnl < 0 ? p.expirationPnl : 0,
    t0Pnl: p.t0Pnl,
  }));
}

export function ShortStrangleRiskChart({
  book,
  privacyMasked = false,
}: {
  book: LiveStructureBook | null;
  privacyMasked?: boolean;
}) {
  const model = useMemo(() => (book ? liveBookToRiskProfile(book) : null), [book]);
  const rows = useMemo(() => (model ? modelToRows(model) : []), [model]);
  const hasT0 = rows.some((r) => r.t0Pnl != null);

  if (!book) {
    return (
      <aside className="hidden min-h-[16rem] flex-1 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-4 dark:border-white/20 dark:bg-zinc-900/40 lg:block">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-300">
          Risk profile
        </div>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
          Expand or click a live book to show its expiration / T+0 P&amp;L chart.
        </p>
      </aside>
    );
  }

  if (!model || rows.length === 0) {
    return (
      <aside className="hidden min-h-[16rem] flex-1 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-4 dark:border-white/20 dark:bg-zinc-900/40 lg:block">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-300">
          Risk profile · {book.underlying}
        </div>
        <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
          Missing entry or mark on live legs — cannot build the payoff curve yet.
        </p>
      </aside>
    );
  }

  const pnlTone =
    model.currentPnl == null ? undefined : model.currentPnl >= 0 ? ("pos" as const) : ("neg" as const);
  const pct =
    model.currentPnlPctOfMax != null ? `${model.currentPnlPctOfMax.toFixed(1)}%` : "—";

  return (
    <aside className="hidden min-h-[16rem] flex-1 rounded-xl border border-zinc-300 bg-zinc-50/80 p-3 dark:border-white/20 dark:bg-zinc-950/80 lg:flex lg:flex-col">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-300">
          Risk profile · {book.underlying}
          {book.kind === "short-strangle" ? " short strangle" : ` ${book.kind}`}
        </div>
        {!hasT0 ? (
          <div className="text-[10px] text-amber-400/90">T+0 needs IV on legs</div>
        ) : null}
      </div>

      <div className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2 sm:grid-cols-3 xl:grid-cols-5">
        <Metric label="Max credit" value={usd(model.maxProfit, privacyMasked)} />
        <Metric label="Current P&L" value={usd(model.currentPnl, privacyMasked)} tone={pnlTone} />
        <Metric label="% of max" value={pct} tone={pnlTone} />
        <Metric label="DTE" value={model.dte != null ? String(model.dte) : "—"} />
        <Metric
          label="Spot"
          value={model.spot != null ? model.spot.toFixed(2) : "—"}
          tone="muted"
        />
      </div>

      <div className="mt-2 h-60 w-full min-w-0 shrink-0" style={{ minHeight: 240 }}>
        <ResponsiveContainer width="100%" height={240} minHeight={240}>
          <ComposedChart data={rows} margin={{ top: 8, right: 8, left: 0, bottom: 4 }}>
            <XAxis
              dataKey="spot"
              type="number"
              domain={["dataMin", "dataMax"]}
              tick={{ fill: "#d4d4d8", fontSize: 10 }}
              tickFormatter={(v: number) => (Number.isFinite(v) ? v.toFixed(0) : "")}
              axisLine={{ stroke: "#52525b" }}
              tickLine={{ stroke: "#52525b" }}
            />
            <YAxis
              tick={{ fill: "#d4d4d8", fontSize: 10 }}
              tickFormatter={(v: number) =>
                Math.abs(v) >= 1000 ? `${(v / 1000).toFixed(1)}k` : String(Math.round(v))
              }
              axisLine={{ stroke: "#52525b" }}
              tickLine={{ stroke: "#52525b" }}
              width={44}
            />
            <Tooltip content={<ChartTooltip />} />
            <ReferenceLine y={0} stroke={ZERO} strokeWidth={1} />
            {model.profitTargetPnl != null ? (
              <ReferenceLine
                y={model.profitTargetPnl}
                stroke={AMBER}
                strokeDasharray="4 4"
                strokeWidth={1}
                label={{
                  value: `${model.profitTargetPct}%`,
                  fill: AMBER,
                  fontSize: 10,
                  position: "insideTopRight",
                }}
              />
            ) : null}
            {model.spot != null ? (
              <ReferenceLine x={model.spot} stroke="#e4e4e7" strokeWidth={1.5} />
            ) : null}
            {model.putStrike != null ? (
              <ReferenceLine x={model.putStrike} stroke="#a78bfa" strokeWidth={1} strokeDasharray="3 3" />
            ) : null}
            {model.callStrike != null ? (
              <ReferenceLine x={model.callStrike} stroke="#a78bfa" strokeWidth={1} strokeDasharray="3 3" />
            ) : null}
            {model.lowerBreakeven != null ? (
              <ReferenceLine
                x={model.lowerBreakeven}
                stroke="#71717a"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
            ) : null}
            {model.upperBreakeven != null ? (
              <ReferenceLine
                x={model.upperBreakeven}
                stroke="#71717a"
                strokeWidth={1}
                strokeDasharray="2 4"
              />
            ) : null}
            <defs>
              <linearGradient id="expPosFill" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor={GREEN} stopOpacity={0.35} />
                <stop offset="100%" stopColor={GREEN} stopOpacity={0.05} />
              </linearGradient>
              <linearGradient id="expNegFill" x1="0" y1="1" x2="0" y2="0">
                <stop offset="0%" stopColor={RED} stopOpacity={0.35} />
                <stop offset="100%" stopColor={RED} stopOpacity={0.05} />
              </linearGradient>
            </defs>
            <Area
              type="monotone"
              dataKey="expPos"
              stroke="none"
              fill="url(#expPosFill)"
              baseValue={0}
              isAnimationActive={false}
              name="Expiration +"
            />
            <Area
              type="monotone"
              dataKey="expNeg"
              stroke="none"
              fill="url(#expNegFill)"
              baseValue={0}
              isAnimationActive={false}
              name="Expiration −"
            />
            <Line
              type="monotone"
              dataKey="expirationPnl"
              stroke={GREEN}
              strokeWidth={1.75}
              dot={false}
              isAnimationActive={false}
              name="Expiration"
            />
            {hasT0 ? (
              <Line
                type="monotone"
                dataKey="t0Pnl"
                stroke={CYAN}
                strokeWidth={1.75}
                dot={false}
                isAnimationActive={false}
                connectNulls
                name="T+0"
              />
            ) : null}
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      <div className="mt-1 flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-zinc-400">
        <span>
          <span className="inline-block h-2 w-2 rounded-sm bg-emerald-500/80" /> Exp +
        </span>
        <span>
          <span className="inline-block h-2 w-2 rounded-sm bg-rose-500/80" /> Exp −
        </span>
        {hasT0 ? (
          <span>
            <span className="inline-block h-0.5 w-3 align-middle bg-cyan-400" /> T+0
          </span>
        ) : null}
        <span>Solid = spot · Purple dashed = strikes · Grey dashed = BEs</span>
        {model.lowerBreakeven != null && model.upperBreakeven != null ? (
          <span className="tabular-nums text-zinc-300">
            BE {model.lowerBreakeven.toFixed(2)} / {model.upperBreakeven.toFixed(2)}
          </span>
        ) : null}
      </div>
    </aside>
  );
}
