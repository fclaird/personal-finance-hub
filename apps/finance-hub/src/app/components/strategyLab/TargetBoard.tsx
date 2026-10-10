"use client";

import { StructureCard } from "@/app/components/strategyLab/StructureCard";
import { formatSignedUsd2 } from "@/lib/format";
import type { OptionChain } from "@/lib/optionChain/chain";
import { bestWhenFor, type Assumptions, type LabEdit, type LabEvaluation, type PricedStructure } from "@/lib/strategyLab/lab";
import { labCard, labControl, labLabel } from "@/lib/strategyLab/palette";
import {
  COST_PER_DELTA_HINT,
  DEFAULT_LEVERAGE_BASIS,
  LEVERAGE_BASES,
  TARGET_LEVERAGE_HINT,
  costPerDeltaLine,
  deltaLabel,
  leverageQuotes,
  leverageValue,
  readTarget,
  type LeverageBasis,
  type LeverageQuote,
  type TargetRead,
} from "@/lib/strategyLab/targetMetrics";

export function readsForHorizon(
  evaluation: LabEvaluation,
  chain: OptionChain,
  assumptions: Assumptions,
  horizonId: string,
  targetSpot: number | null,
): Map<string, TargetRead> {
  const horizon = horizonId === "expiry" ? null : evaluation.horizons.find((item) => item.id === horizonId);
  const reads = new Map<string, TargetRead>();
  for (const row of evaluation.structures) {
    if (row.status !== "priced") continue;
    const read = readTarget({
      row,
      assumptions,
      chain,
      date: horizon?.date ?? row.spec.expiry,
      targetSpot,
    });
    if (read) reads.set(row.spec.id, read);
  }
  return reads;
}

export function TargetSection({
  evaluation,
  chain,
  assumptions,
  horizonId,
  onHorizon,
  targetText,
  onTargetText,
  leverageBasis,
  onLeverageBasis,
  masked,
  onEdit,
}: {
  evaluation: LabEvaluation;
  chain: OptionChain;
  assumptions: Assumptions;
  horizonId: string;
  onHorizon: (id: string) => void;
  targetText: string;
  onTargetText: (value: string) => void;
  leverageBasis: LeverageBasis;
  onLeverageBasis: (basis: LeverageBasis) => void;
  masked: boolean;
  onEdit: (edit: LabEdit | readonly LabEdit[]) => void;
}) {
  const typed = Number(targetText);
  const targetSpot = targetText.trim() !== "" && Number.isFinite(typed) && typed > 0 ? typed : null;
  const reads = readsForHorizon(evaluation, chain, assumptions, horizonId, targetSpot);
  const quotes = new Map<string, readonly LeverageQuote[]>();
  for (const row of evaluation.structures) {
    if (row.status !== "priced") continue;
    const set = leverageQuotes(row, chain.spot, reads.get(row.spec.id) ?? null);
    if (set) quotes.set(row.spec.id, set);
  }
  return (
    <>
      <TargetBoard
        evaluation={evaluation}
        horizonId={horizonId}
        onHorizon={onHorizon}
        targetText={targetText}
        onTargetText={onTargetText}
        reads={reads}
        quotes={quotes}
        leverageBasis={leverageBasis}
        onLeverageBasis={onLeverageBasis}
        masked={masked}
      />
      <div className="grid gap-4 lg:grid-cols-3">
        {evaluation.structures.map((row) => (
          <StructureCard
            key={row.spec.id}
            chain={chain}
            assumptions={assumptions}
            row={row}
            masked={masked}
            bestWhen={bestWhenFor(evaluation.expiryBoards, row.spec.id)}
            target={row.status === "priced" ? (reads.get(row.spec.id) ?? null) : null}
            leverage={row.status === "priced" ? (quotes.get(row.spec.id) ?? null) : null}
            leverageBasis={leverageBasis}
            onEdit={onEdit}
          />
        ))}
      </div>
    </>
  );
}

function TargetBoard({
  evaluation,
  horizonId,
  onHorizon,
  targetText,
  onTargetText,
  reads,
  quotes,
  leverageBasis,
  onLeverageBasis,
  masked,
}: {
  evaluation: LabEvaluation;
  horizonId: string;
  onHorizon: (id: string) => void;
  targetText: string;
  onTargetText: (value: string) => void;
  reads: Map<string, TargetRead>;
  quotes: Map<string, readonly LeverageQuote[]>;
  leverageBasis: LeverageBasis;
  onLeverageBasis: (basis: LeverageBasis) => void;
  masked: boolean;
}) {
  const dates = evaluation.horizons.filter((horizon) => horizon.shared && !horizon.settlement);
  const priced = evaluation.structures.filter((row): row is PricedStructure => row.status === "priced");
  return (
    <section id="if-target-reached" className={`${labCard} p-4`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">If the target is reached</h2>
          <p className="mt-1 max-w-3xl text-xs text-zinc-700 dark:text-zinc-300" title={TARGET_LEVERAGE_HINT}>
            Leverage = (share-equivalent delta × stock price) / dollars invested. Worked example: a $100 stock, 100 delta-shares, $1,000 invested = 10×. Idle cash stays out of the denominator. {COST_PER_DELTA_HINT}
          </p>
        </div>
        <label className={labLabel}>
          Target price
          <input
            aria-label="Target price"
            type="number"
            min={0}
            step="0.01"
            placeholder="Short strike"
            value={targetText}
            onChange={(event) => onTargetText(event.target.value)}
            className={`mt-1 block w-32 px-2 py-1 text-sm tabular-nums ${labControl}`}
          />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Delta basis for leverage">
        {LEVERAGE_BASES.map((item) => (
          <HorizonChip
            key={item.id}
            radio
            on={leverageBasis === item.id}
            onClick={() => onLeverageBasis(item.id)}
            label={item.id === DEFAULT_LEVERAGE_BASIS ? `${item.label} (default)` : item.label}
          />
        ))}
      </div>
      <p className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-300">
        The bold Leverage line on each tile uses this delta. Short strike at expiry is the settled share count just through that strike, times the strike. A capped spread also shows the long leg only, just inside the strike, because the delta beyond it is about 0. Target price and date follows the horizon and the price box.
      </p>
      <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Target horizon">
        <HorizonChip on={horizonId === "expiry"} onClick={() => onHorizon("expiry")} label="Expiry" />
        {dates.map((horizon) => (
          <HorizonChip key={horizon.id} on={horizonId === horizon.id} onClick={() => onHorizon(horizon.id)} label={horizon.label.split(" · ")[0] ?? horizon.label} />
        ))}
      </div>
      <div className="mt-3 overflow-x-auto">
        <table className="w-full min-w-[46rem] text-left text-sm text-zinc-900 dark:text-zinc-100">
          <thead>
            <tr className="text-[11px] uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
              <th className="py-1 pr-3 font-semibold">Structure</th>
              <th className="py-1 pr-3 font-semibold">Target</th>
              <th className="py-1 pr-3 font-semibold">Delta</th>
              <th className="py-1 pr-3 font-semibold">Cost per delta</th>
              <th className="py-1 pr-3 font-semibold">Leverage</th>
              <th className="py-1 pr-3 font-semibold">P&amp;L</th>
              <th className="py-1 font-semibold">Multiple</th>
            </tr>
          </thead>
          <tbody>
            {priced.map((row) => {
              const read = reads.get(row.spec.id) ?? null;
              return (
                <tr key={row.spec.id} className="border-t border-zinc-300 dark:border-zinc-700">
                  <td className="py-1.5 pr-3 font-semibold">{row.spec.label}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{read ? read.target.toFixed(2) : "—"}</td>
                  <td className="py-1.5 pr-3 tabular-nums">{read ? deltaLabel(read) : "—"}</td>
                  <td className="py-1.5 pr-3" title={COST_PER_DELTA_HINT}>
                    {read ? costPerDeltaLine(read) : "—"}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums" title={TARGET_LEVERAGE_HINT}>
                    <LeverageLines quotes={quotes.get(row.spec.id) ?? null} basis={leverageBasis} />
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums">{read?.pnl != null ? formatSignedUsd2(read.pnl, { mask: masked }) : "—"}</td>
                  <td className="py-1.5 tabular-nums">{read?.multiple != null ? `${read.multiple.toFixed(2)}×` : "—"}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function LeverageLines({ quotes, basis }: { quotes: readonly LeverageQuote[] | null; basis: LeverageBasis }) {
  if (!quotes) return "—";
  const ordered = [...quotes].sort((a, b) => (a.basis === basis ? -1 : b.basis === basis ? 1 : 0));
  return (
    <div className="space-y-0.5">
      {ordered.map((quote) => {
        const headline = quote.basis === basis;
        return (
          <div key={quote.basis} className={headline ? "font-bold" : "text-xs font-normal text-zinc-600 dark:text-zinc-400"}>
            {headline ? "Leverage" : quote.title} {leverageValue(quote)}
          </div>
        );
      })}
    </div>
  );
}

function HorizonChip({ on, onClick, label, radio }: { on: boolean; onClick: () => void; label: string; radio?: boolean }) {
  return (
    <button
      type="button"
      role={radio ? "radio" : undefined}
      aria-checked={radio ? on : undefined}
      aria-pressed={radio ? undefined : on}
      onClick={onClick}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        on
          ? "bg-zinc-950 text-white dark:bg-zinc-100 dark:text-zinc-950"
          : "border border-zinc-500 text-zinc-800 dark:border-zinc-400 dark:text-zinc-100"
      }`}
    >
      {label}
    </button>
  );
}

