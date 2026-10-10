"use client";

import { useMemo, useState } from "react";

import { DeltaMarkChips, StrikeSelect } from "@/app/components/strategyLab/StrikeSelect";
import { formatExpiryLabel, type OptionChain, type OptionRight } from "@/lib/optionChain/chain";
import { formatNum, formatSignedUsd2, formatUsd2 } from "@/lib/format";
import type { LabEdit, StructureEval } from "@/lib/strategyLab/lab";
import {
  CAPPED_DELTA,
  COST_PER_DELTA_HINT,
  costPerDeltaLine,
  describeShareDelta,
  shortCallStrike,
  TARGET_LEVERAGE_HINT,
  type TargetRead,
} from "@/lib/strategyLab/targetMetrics";
import { LAB_PALETTE, labControl, labLabel } from "@/lib/strategyLab/palette";
import {
  formatModelDelta,
  nearestDeltaStrike,
  strikeDeltas,
  structureDeltaSummary,
  type DeltaAssumptions,
  type StrikeDelta,
} from "@/lib/strategyLab/strikeDelta";

function usd(n: number | null | undefined, mask: boolean): string {
  return formatUsd2(n, { mask });
}

function signed(n: number | null | undefined, mask: boolean): string {
  return formatSignedUsd2(n, { mask });
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative min-w-0" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300" title={hint}>
        {label}
      </div>
      <div className="truncate text-sm tabular-nums font-medium" title={hint}>
        {value}
      </div>
      {hint && open ? (
        <p
          role="tooltip"
          className="absolute left-0 top-full z-20 mt-1 w-64 rounded border border-zinc-500 bg-zinc-950 p-2 text-[11px] font-normal normal-case leading-snug tracking-normal text-zinc-100"
        >
          {hint}
        </p>
      ) : null}
    </div>
  );
}

const MOVE_HINT =
  "Approximate P&L if the stock moves 1% from today's spot, using today's share-equivalent exposure times 1%. Gamma is not included.";
const MULTIPLE_HINT = "Position value at the target divided by dollars invested. Value is the dollars invested plus the P&L at that spot.";

function DollarsAtRisk({ row, onEdit }: { row: StructureEval; onEdit: (edit: LabEdit) => void }) {
  const spec = row.spec;
  const templateName = spec.origin?.request.template;
  const unbounded = row.status === "priced" && row.risk.maxLoss === "unbounded";
  const synthetic = templateName === "syntheticLong";
  const strangle = templateName === "shortStrangle";
  if (!unbounded && !synthetic && !strangle) return null;
  const required = unbounded || strangle;
  return (
    <label className={`mb-3 block ${labLabel}`}>
      Dollars at risk
      <input
        aria-label={`${spec.label} dollars at risk`}
        type="number"
        min={1}
        step="1"
        placeholder={required ? "Required" : "Optional"}
        value={spec.capitalOverride ?? ""}
        onChange={(event) => {
          const raw = event.target.value.trim();
          if (raw === "") {
            onEdit({ kind: "setCapitalOverride", id: spec.id, dollars: null });
            return;
          }
          const dollars = Number(raw);
          if (Number.isFinite(dollars) && dollars > 0) onEdit({ kind: "setCapitalOverride", id: spec.id, dollars });
        }}
        className={`mt-1 block w-32 px-2 py-1.5 text-sm tabular-nums ${labControl}`}
      />
      <span className="mt-1 block text-[11px]">
        {required ? "Required. Undefined risk. No margin formula." : "Blank uses the loss at spot 0."}
      </span>
    </label>
  );
}

function isZebra(row: StructureEval): boolean {
  const spec = row.spec;
  if (spec.origin?.request.template === "zebra") return true;
  return (
    spec.legs.length === 2 &&
    spec.legs[0]?.right === "C" &&
    spec.legs[0]?.ratio === 2 &&
    spec.legs[1]?.right === "C" &&
    spec.legs[1]?.ratio === -1
  );
}

export function StructureCard({
  chain,
  assumptions,
  row,
  masked,
  bestWhen,
  target,
  onEdit,
}: {
  chain: OptionChain;
  assumptions: DeltaAssumptions;
  row: StructureEval;
  masked: boolean;
  bestWhen: string;
  target: TargetRead | null;
  onEdit: (edit: LabEdit | readonly LabEdit[]) => void;
}) {
  const spec = row.spec;
  const color = LAB_PALETTE.series[spec.slot] ?? LAB_PALETTE.series[0];
  const [longTarget, setLongTarget] = useState("75");
  const [shortTarget, setShortTarget] = useState("50");
  const boards = useMemo(() => {
    const byRight = new Map<OptionRight, readonly StrikeDelta[]>();
    for (const leg of spec.legs) {
      if (!byRight.has(leg.right)) byRight.set(leg.right, strikeDeltas(chain, spec.expiry, leg.right, assumptions));
    }
    return byRight;
  }, [chain, spec.expiry, spec.legs, assumptions]);
  const summary = structureDeltaSummary(spec.legs, (right, strike) => {
    const rowDelta = boards.get(right)?.find((item) => item.strike === strike)?.delta;
    return rowDelta ?? null;
  });
  const zebra = isZebra(row);

  return (
    <article className="rounded-xl border-2 bg-white p-4 dark:bg-zinc-950" style={{ borderColor: color }}>
      <div className="mb-3 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="inline-block h-4 w-4 shrink-0 rounded-sm border border-zinc-950" style={{ backgroundColor: color }} aria-hidden />
          <span className="rounded-full px-2 py-0.5 text-xs font-bold text-zinc-950" style={{ backgroundColor: color }}>
            {spec.label || "Structure"}
          </span>
          <input
            aria-label={`${spec.label} name`}
            value={spec.label}
            onChange={(e) => onEdit({ kind: "setLabel", id: spec.id, label: e.target.value })}
            className="w-28 border-2 bg-transparent px-2 py-1 text-sm font-semibold text-zinc-950 dark:text-zinc-50"
            style={{ borderColor: color }}
          />
        </div>
        <button
          type="button"
          onClick={() => onEdit({ kind: "removeStructure", id: spec.id })}
          className="text-xs font-medium text-zinc-600 hover:text-rose-500 dark:text-zinc-300"
        >
          Remove
        </button>
      </div>
      <p className="mb-3 border-l-4 pl-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100" style={{ borderColor: color }}>
        {bestWhen}
      </p>

      <label className={`mb-3 block ${labLabel}`}>
        Expiry
        <select
          aria-label={`${spec.label} expiry`}
          value={spec.expiry}
          onChange={(e) => onEdit({ kind: "setExpiry", id: spec.id, expiry: e.target.value as typeof spec.expiry })}
          className={`mt-1 block w-full px-2 py-1.5 text-sm ${labControl}`}
        >
          {chain.expiries.map((expiry) => (
            <option key={expiry.date} value={expiry.date}>
              {formatExpiryLabel(expiry.date)}
            </option>
          ))}
        </select>
      </label>

      {spec.legs.map((leg, index) => (
        <div key={`${spec.id}-${index}`} className="mb-2 flex items-end gap-2">
          <StrikeSelect
            label={`${leg.ratio > 0 ? "Long" : "Short"} ${Math.abs(leg.ratio)}× ${leg.right === "C" ? "call" : "put"}`}
            ariaLabel={`${spec.label} leg ${index + 1} strike`}
            rows={boards.get(leg.right) ?? []}
            value={String(leg.strike)}
            onChange={(strike) => onEdit({ kind: "setStrike", id: spec.id, legIndex: index, strike })}
          />
          <button
            type="button"
            aria-label={`${spec.label} leg ${index + 1} down`}
            className={`px-2 py-1.5 text-sm ${labControl}`}
            onClick={() => onEdit({ kind: "stepStrike", id: spec.id, legIndex: index, steps: -1 })}
          >
            −
          </button>
          <button
            type="button"
            aria-label={`${spec.label} leg ${index + 1} up`}
            className={`px-2 py-1.5 text-sm ${labControl}`}
            onClick={() => onEdit({ kind: "stepStrike", id: spec.id, legIndex: index, steps: 1 })}
          >
            +
          </button>
          {spec.origin?.request.template === "custom" ? (
            <button
              type="button"
              aria-label={`${spec.label} drop leg ${index + 1}`}
              className={`px-2 py-1.5 text-xs font-semibold ${labControl}`}
              onClick={() => onEdit({ kind: "removeLeg", id: spec.id, legIndex: index })}
            >
              Drop
            </button>
          ) : null}
          <label className={labLabel}>
            IV %
            <input
              aria-label={`${spec.label} leg ${index + 1} IV`}
              type="number"
              step="0.1"
              placeholder="auto"
              value={leg.ivOverride == null ? "" : String(Math.round(leg.ivOverride * 1000) / 10)}
              onChange={(e) => {
                const raw = e.target.value.trim();
                const next = Number(raw);
                onEdit({
                  kind: "setIvOverride",
                  id: spec.id,
                  legIndex: index,
                  iv: raw === "" || !Number.isFinite(next) ? null : next / 100,
                });
              }}
              className={`mt-1 block w-16 px-2 py-1.5 text-sm tabular-nums ${labControl}`}
            />
          </label>
        </div>
      ))}

      {[...boards.entries()].map(([right, rows]) => (
        <DeltaMarkChips key={right} rows={rows} />
      ))}
      <p className="mb-1 mt-2 text-sm font-semibold tabular-nums text-zinc-950 dark:text-zinc-50">
        Approx net Δ {summary.net == null ? "—" : summary.net.toFixed(1)}
        {summary.ratio == null ? "" : ` · ratio ${summary.ratio.toFixed(2)}`}
        {summary.legs.length > 0
          ? ` · ${summary.legs.map((leg) => `${leg.strike} Δ ${leg.delta == null ? "—" : formatModelDelta(leg.delta)}`).join(" / ")}`
          : ""}
      </p>
      <p className="mb-3 text-[11px] text-zinc-600 dark:text-zinc-300">
        Model delta from the mid, rate, dividend yield, and spot. Approximate. Amber is nearest .75, cyan is nearest .50.
      </p>
      {zebra ? (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className={labLabel}>
            Long Δ target
            <input
              aria-label={`${spec.label} long delta target`}
              type="number"
              min={1}
              max={99}
              step={1}
              value={longTarget}
              onChange={(event) => setLongTarget(event.target.value)}
              className={`mt-1 block w-20 px-2 py-1 text-sm tabular-nums ${labControl}`}
            />
          </label>
          <label className={labLabel}>
            Short Δ target
            <input
              aria-label={`${spec.label} short delta target`}
              type="number"
              min={1}
              max={99}
              step={1}
              value={shortTarget}
              onChange={(event) => setShortTarget(event.target.value)}
              className={`mt-1 block w-20 px-2 py-1 text-sm tabular-nums ${labControl}`}
            />
          </label>
          <button
            type="button"
            className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
            onClick={() => {
              const calls = boards.get("C") ?? [];
              const long = nearestDeltaStrike(calls, Number(longTarget) / 100, "lower");
              const short = nearestDeltaStrike(calls, Number(shortTarget) / 100, "higher");
              const longIndex = spec.legs.findIndex((leg) => leg.ratio > 0);
              const shortIndex = spec.legs.findIndex((leg) => leg.ratio < 0);
              if (long == null || short == null || longIndex < 0 || shortIndex < 0 || long === short) return;
              onEdit([
                { kind: "setStrike", id: spec.id, legIndex: longIndex, strike: long },
                { kind: "setStrike", id: spec.id, legIndex: shortIndex, strike: short },
              ]);
            }}
          >
            Snap to nearest strike
          </button>
        </div>
      ) : null}

      <fieldset className={`mb-3 mt-3 ${labLabel}`}>
        <legend className="mb-1">Entry</legend>
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-900 dark:text-zinc-50">
          {(["mid", "natural"] as const).map((kind) => (
            <label key={kind} className="inline-flex items-center gap-1">
              <input
                type="radio"
                name={`entry-${spec.id}`}
                checked={spec.entry.kind === kind}
                onChange={() => onEdit({ kind: "setEntry", id: spec.id, entry: { kind } })}
              />
              {kind}
            </label>
          ))}
          <label className="inline-flex items-center gap-1">
            <input
              type="radio"
              name={`entry-${spec.id}`}
              checked={spec.entry.kind === "limit"}
              onChange={() =>
                onEdit({
                  kind: "setEntry",
                  id: spec.id,
                  entry: { kind: "limit", netPerShare: spec.entry.kind === "limit" ? spec.entry.netPerShare : 0 },
                })
              }
            />
            limit
            <input
              aria-label={`${spec.label} limit`}
              type="number"
              step="0.01"
              value={spec.entry.kind === "limit" ? spec.entry.netPerShare : ""}
              onChange={(e) =>
                onEdit({
                  kind: "setEntry",
                  id: spec.id,
                  entry: { kind: "limit", netPerShare: Number(e.target.value) },
                })
              }
              className={`w-24 px-2 py-1 tabular-nums ${labControl}`}
            />
          </label>
        </div>
      </fieldset>

      <DollarsAtRisk row={row} onEdit={onEdit} />

      {row.status === "blocked" ? (
        <p className="text-sm text-rose-600">{row.reason}</p>
      ) : (
        <>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Debit" value={usd(row.debit, masked)} />
          <Stat label="Breakeven" value={row.risk.breakevens.map((b) => b.toFixed(2)).join(", ") || "—"} />
          <Stat label="Max loss" value={row.risk.maxLoss === "unbounded" ? "Unbounded" : usd(row.risk.maxLoss, masked)} />
          <Stat label="Max gain" value={row.risk.maxGain === "unbounded" ? "Uncapped" : usd(row.risk.maxGain, masked)} />
          <Stat label="Intrinsic" value={usd(row.risk.intrinsic, masked)} />
          <Stat label="Extrinsic" value={usd(row.risk.extrinsic, masked)} />
          <Stat
            label="Packages"
            value={
              row.sizing.status === "needsCapitalOverride"
                ? "Needs $"
                : `${row.spec.label}: ${formatNum(row.sizing.packages, Number.isInteger(row.sizing.packages) ? 0 : 1)} ${row.sizing.packages === 1 ? "package" : "packages"}`
            }
          />
          <Stat
            label="Invested"
            value={row.sizing.status === "needsCapitalOverride" ? "—" : usd(row.sizing.invested, masked)}
          />
          <Stat label="Idle cash" value={row.sizing.status === "sized" ? usd(row.sizing.idleCash, masked) : usd(0, masked)} />
          <Stat
            label="Leverage if target reached"
            hint={TARGET_LEVERAGE_HINT}
            value={
              target == null
                ? "—"
                : target.capped
                  ? CAPPED_DELTA
                  : target.leverageAtTarget != null
                    ? `${target.leverageAtTarget.toFixed(2)}×`
                    : "—"
            }
          />
          <Stat
            label="at entry"
            hint={TARGET_LEVERAGE_HINT}
            value={
              row.sizing.status !== "needsCapitalOverride" && row.sizing.leverage != null
                ? `${row.sizing.leverage.toFixed(2)}×`
                : "—"
            }
          />
          <Stat
            label="P&L per 1% stock move"
            hint={MOVE_HINT}
            value={
              row.sizing.status !== "needsCapitalOverride" && row.sizing.pnlPerPercent != null
                ? signed(row.sizing.pnlPerPercent, masked)
                : "—"
            }
          />
          <Stat
            label="Delta if short strike is reached"
            hint={COST_PER_DELTA_HINT}
            value={target ? describeShareDelta(target.positionDelta, target.capped) : "—"}
          />
          <Stat
            label="P&L at target"
            value={target?.pnl != null ? signed(target.pnl, masked) : "—"}
          />
          <Stat
            label="If the trade works"
            hint={MULTIPLE_HINT}
            value={target?.multiple != null ? `${target.multiple.toFixed(2)}× invested` : "—"}
          />
          <Stat label="Delta" value={row.greeks ? formatNum(row.greeks.delta, 1) : "—"} />
          <Stat label="Gamma" value={row.greeks ? formatNum(row.greeks.gamma, 3) : "—"} />
          <Stat label="Theta / day" value={row.greeks ? signed(row.greeks.theta, masked) : "—"} />
          <Stat label="Vega / pt" value={row.greeks ? signed(row.greeks.vega, masked) : "—"} />
          <Stat label="Halfway" value={formatExpiryLabel(row.ownHalfway)} />
          <Stat
            label="Slope above"
            value={masked ? "XXXXX" : row.risk.slopeAbove === 0 ? "Flat" : `${row.risk.slopeAbove > 0 ? "+" : ""}$${row.risk.slopeAbove}`}
          />
        </div>
        {target ? (
          <p className="mt-3 text-sm text-zinc-900 dark:text-zinc-100" title={COST_PER_DELTA_HINT}>
            {costPerDeltaLine(target)}
          </p>
        ) : row.status === "priced" && shortCallStrike(row.legs) == null ? (
          <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">Set a target price. This structure has no short call.</p>
        ) : null}
        </>
      )}
    </article>
  );
}
