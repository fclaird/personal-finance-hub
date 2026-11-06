"use client";

import { useMemo, useState } from "react";

import { LegEditor } from "@/app/components/strategyLab/LegEditor";
import { DeltaMarkChips } from "@/app/components/strategyLab/StrikeSelect";
import { calendarDaysBetween, formatExpiryLabel, type OptionChain, type OptionRight } from "@/lib/optionChain/chain";
import { bsmGreeks } from "@/lib/options/blackScholes";
import { formatNum, formatSignedUsd2, formatUsd2 } from "@/lib/format";
import { MODEL_DIVIDEND_YIELD, MODEL_RATE, underlyingModelIv } from "@/lib/strategyLab/modelAssumptions";
import type { LabEdit, StructureEval } from "@/lib/strategyLab/lab";
import {
  DELTA_AT_SHORT_HINT,
  LEVERAGE_NOW_HINT,
  MAX_PROFIT_HINT,
  PEAK_LEVERAGE_HINT,
  RETURN_ON_DEBIT_HINT,
  deltaLabel,
  formatLeverage,
  formatMaxProfitMultiple,
  formatPeakLeverage,
  targetStrike,
  type TargetRead,
  type TileMetrics,
} from "@/lib/strategyLab/targetMetrics";
import { packageUsesEntryCost } from "@/lib/strategyLab/entryCost";
import { labControl, labLabel, seriesColor } from "@/lib/strategyLab/palette";
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

function Stat({ label, value, hint, headline = false }: { label: string; value: string; hint?: string; headline?: boolean }) {
  const [open, setOpen] = useState(false);
  return (
    <div className="relative min-w-0" onMouseEnter={() => setOpen(true)} onMouseLeave={() => setOpen(false)}>
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300" title={hint}>
        {label}
      </div>
      <div className={`truncate tabular-nums font-medium ${headline ? "text-base font-semibold text-zinc-950 dark:text-zinc-50" : "text-sm"}`} title={hint}>
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

function DollarsAtRisk({ row, onEdit, masked, label }: { row: StructureEval; onEdit: (edit: LabEdit) => void; masked: boolean; label: string }) {
  const spec = row.spec;
  if (row.status !== "priced") return null;
  const templateName = spec.origin?.request.template;
  const synthetic = templateName === "syntheticLong" || (row.debit > 0 && row.risk.slopeAbove > 0 && row.risk.slopeBelow > 0);
  const nakedPuts = row.putProxy > 0 && row.risk.slopeBelow > 0 && !row.callRiskRequired && !synthetic;
  if (!row.callRiskRequired && !nakedPuts && !synthetic) return null;
  const required = row.callRiskRequired;
  const proxy = usd(row.putProxy, masked);
  return (
    <label className={`mb-3 block ${labLabel}`}>
      Dollars at risk
      <input
        aria-label={`${label} dollars at risk`}
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
      <span className="mt-1 block text-[11px] text-zinc-700 dark:text-zinc-300">
        {required
          ? row.putProxy > 0
            ? `Required on the call side. Put side cash-secured proxy ${proxy}. Package cost adds them. No broker margin.`
            : "Required. Undefined risk. No broker margin."
          : nakedPuts
            ? `Cash-secured proxy ${proxy}. Blank uses that. Editable. No broker margin.`
            : "Blank sizes on the parity debit. Loss at spot 0 stays on the card."}
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
  metrics,
  plotted = true,
  onPlot,
  onEdit,
  displayLabel,
}: {
  chain: OptionChain;
  assumptions: DeltaAssumptions;
  row: StructureEval;
  masked: boolean;
  bestWhen: string;
  target: TargetRead | null;
  metrics: TileMetrics | null;
  plotted?: boolean;
  onPlot?: () => void;
  onEdit: (edit: LabEdit | readonly LabEdit[]) => void;
  displayLabel?: string;
}) {
  const spec = row.spec;
  const shown = displayLabel || spec.label || "Structure";
  const color = seriesColor(spec.slot);
  const [longTarget, setLongTarget] = useState("75");
  const [shortTarget, setShortTarget] = useState("50");
  const boards = useMemo(() => {
    const byRight = new Map<OptionRight, readonly StrikeDelta[]>();
    for (const leg of spec.legs) {
      if (leg.right == null || leg.expiry == null || byRight.has(leg.right)) continue;
      byRight.set(leg.right, strikeDeltas(chain, leg.expiry, leg.right, assumptions));
    }
    return byRight;
  }, [chain, spec.legs, assumptions]);
  const modelIv = underlyingModelIv(chain);
  const summary = structureDeltaSummary(
    spec.legs.filter((leg): leg is typeof leg & { right: OptionRight; strike: number } => leg.right != null && leg.strike != null),
    (right, strike) => {
      const leg = spec.legs.find((item) => item.right === right && item.strike === strike);
      const iv = leg?.ivOverride != null && leg.ivOverride > 0 ? leg.ivOverride : modelIv;
      if (iv == null || !(iv > 0) || leg?.expiry == null) return null;
      const years = calendarDaysBetween(chain.tradeDate, leg.expiry) / 365;
      if (!(years > 1e-8)) return null;
      return bsmGreeks({
        right,
        spot: chain.spot,
        strike,
        years,
        rate: MODEL_RATE,
        dividendYield: MODEL_DIVIDEND_YIELD,
        vol: iv,
      }).delta;
    },
  );
  const zebra = isZebra(row);

  return (
    <article className="box-border min-w-0 max-w-full rounded-xl border-2 bg-white p-4 dark:bg-zinc-950" style={{ borderColor: color }}>
      <div className="mb-3 h-1.5 rounded-full" style={{ backgroundColor: color }} />
      <div className="mb-3 flex min-w-0 flex-wrap items-center justify-between gap-2">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <span className="inline-block h-4 w-4 shrink-0 rounded-sm border border-zinc-950" style={{ backgroundColor: color }} aria-hidden />
          <span className="rounded-full px-2 py-0.5 text-xs font-bold text-zinc-950" style={{ backgroundColor: color }}>
            {shown}
          </span>
          <input
            aria-label={`${shown} name`}
            value={spec.label}
            onChange={(e) => onEdit({ kind: "setLabel", id: spec.id, label: e.target.value })}
            className="w-28 min-w-0 max-w-full border-2 bg-transparent px-2 py-1 text-sm font-semibold text-zinc-950 dark:text-zinc-50"
            style={{ borderColor: color }}
          />
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
          <label className="inline-flex min-w-0 items-center gap-1.5 text-xs font-semibold" style={{ color }}>
            <input
              type="checkbox"
              checked={plotted}
              onChange={() => onPlot?.()}
              aria-label={`Plot ${shown} on delta chart`}
              className="h-4 w-4"
              style={{ accentColor: color }}
            />
            Plot on delta chart
          </label>
          <button
            type="button"
            onClick={() => onEdit({ kind: "duplicateStructure", id: spec.id })}
            className="text-xs font-medium text-zinc-700 dark:text-zinc-200"
          >
            Copy
          </button>
          <button
            type="button"
            onClick={() => onEdit({ kind: "removeStructure", id: spec.id })}
            className="text-xs font-medium text-zinc-600 hover:text-rose-500 dark:text-zinc-300"
          >
            Remove
          </button>
        </div>
      </div>
      <p className="mb-3 border-l-4 pl-2 text-xs font-semibold text-zinc-800 dark:text-zinc-100" style={{ borderColor: color }}>
        {bestWhen}
      </p>

      <label className={`mb-3 block ${labLabel}`}>
        Expiry
        <select
          aria-label={`${shown} expiry`}
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

      {spec.legs.some((leg) => leg.instrument === "put" && leg.side === "short") ? (
        <p className="mb-2 text-[11px] text-zinc-700 dark:text-zinc-300">
          European model. A short put can be exercised early; this price does not include that.
        </p>
      ) : null}

      {spec.legs.map((leg, index) => (
        <LegEditor
          key={leg.id || `${spec.id}-${index}`}
          leg={leg}
          index={index}
          structureId={spec.id}
          structureLabel={shown}
          chain={chain}
          assumptions={assumptions}
          onEdit={onEdit}
        />
      ))}
      <button
        type="button"
        className={`mb-3 px-2 py-1.5 text-xs font-semibold ${labControl}`}
        disabled={spec.legs.length >= 8}
        onClick={() => onEdit({ kind: "addBlankLeg", id: spec.id })}
      >
        Add leg
      </button>

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
        One average IV, rate 4%, no dividend. Quote IV stays on the leg. Amber is nearest .75, cyan is nearest .50, magenta is nearest .15.
      </p>
      {zebra ? (
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className={labLabel}>
            Long Δ target
            <input
              aria-label={`${shown} long delta target`}
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
              aria-label={`${shown} short delta target`}
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

      {packageUsesEntryCost(spec.legs) ? (
        <p className="mb-3 text-sm text-zinc-100">Package debit uses each leg&apos;s book or manual price.</p>
      ) : (
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
              aria-label={`${shown} limit`}
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
      )}

      <DollarsAtRisk row={row} onEdit={onEdit} masked={masked} label={shown} />

      {row.status === "blocked" ? (
        <p className="text-sm text-rose-600">{row.reason}</p>
      ) : (
        <>
        <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Stat headline label="Leverage now" hint={LEVERAGE_NOW_HINT} value={formatLeverage(metrics?.leverageNow ?? null)} />
          <Stat headline label="Peak leverage" hint={PEAK_LEVERAGE_HINT} value={formatPeakLeverage(metrics?.peakLeverage ?? null, metrics?.peakSpot ?? null)} />
          <Stat headline label="Max profit" hint={MAX_PROFIT_HINT} value={formatMaxProfitMultiple(metrics)} />
          <Stat
            headline
            label={metrics?.returnBasis === "risk" ? "Return on risk at target" : "Return on debit at target"}
            hint={RETURN_ON_DEBIT_HINT}
            value={formatLeverage(metrics?.returnOnDebit ?? null)}
          />
        </div>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
          <Stat label="Debit" value={usd(row.debit, masked)} />
          {row.daysHeld != null ? <Stat label="Days held" value={String(row.daysHeld)} /> : null}
          {row.parityDebit != null ? (
            <Stat label="Quoted net" value={usd(row.quotedDebit, masked)} />
          ) : null}
          <Stat label="Breakeven" value={row.risk.breakevens.map((b) => b.toFixed(2)).join(", ") || "—"} />
          <Stat label="Max loss" value={row.risk.maxLoss === "unbounded" ? "Unbounded" : usd(row.risk.maxLoss, masked)} />
          <Stat label="Upside" value={row.risk.maxLossUp === "unbounded" ? "Unbounded" : usd(row.risk.maxLossUp, masked)} />
          <Stat
            label="Downside"
            value={row.risk.maxLossDown === "flat" ? "Flat" : `to zero ${usd(row.risk.maxLossDown, masked)}`}
          />
          <Stat label="Max gain" value={row.risk.maxGain === "unbounded" ? "Uncapped" : usd(row.risk.maxGain, masked)} />
          <Stat label="Intrinsic" value={usd(row.risk.intrinsic, masked)} />
          <Stat label="Extrinsic" value={usd(row.risk.extrinsic, masked)} />
          <Stat
            label="Packages"
            value={
              row.sizing.status === "needsCapitalOverride"
                ? "Needs $"
                : `${shown}: ${formatNum(row.sizing.packages, Number.isInteger(row.sizing.packages) ? 0 : 1)} ${row.sizing.packages === 1 ? "package" : "packages"}`
            }
          />
          <Stat
            label="Invested"
            value={row.sizing.status === "needsCapitalOverride" ? "—" : usd(row.sizing.invested, masked)}
          />
          <Stat label="Idle cash" value={row.sizing.status === "sized" ? usd(row.sizing.idleCash, masked) : usd(0, masked)} />
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
            hint={DELTA_AT_SHORT_HINT}
            value={target ? deltaLabel(target) : "—"}
          />
          <Stat
            label="P&L at target"
            value={target?.pnl != null ? signed(target.pnl, masked) : "—"}
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
        {row.status === "priced" && targetStrike(row.legs) == null && target == null ? (
          <p className="mt-3 text-sm text-zinc-700 dark:text-zinc-300">Set a target price. This structure has no single short strike.</p>
        ) : null}
        </>
      )}
    </article>
  );
}
