"use client";

import { StructureCard } from "@/app/components/strategyLab/StructureCard";
import { formatSignedUsd2 } from "@/lib/format";
import type { OptionChain } from "@/lib/optionChain/chain";
import { bestWhenFor, type Assumptions, type LabEdit, type LabEvaluation, type PricedStructure } from "@/lib/strategyLab/lab";
import { labCard, labControl, labLabel } from "@/lib/strategyLab/palette";
import {
  CAPPED_DELTA,
  COST_PER_DELTA_HINT,
  costPerDeltaLine,
  describeShareDelta,
  readTarget,
  TARGET_LEVERAGE_HINT,
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
  masked: boolean;
  onEdit: (edit: LabEdit | readonly LabEdit[]) => void;
}) {
  const typed = Number(targetText);
  const targetSpot = targetText.trim() !== "" && Number.isFinite(typed) && typed > 0 ? typed : null;
  const reads = readsForHorizon(evaluation, chain, assumptions, horizonId, targetSpot);
  return (
    <>
      <TargetBoard
        evaluation={evaluation}
        horizonId={horizonId}
        onHorizon={onHorizon}
        targetText={targetText}
        onTargetText={onTargetText}
        reads={reads}
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
  masked,
}: {
  evaluation: LabEvaluation;
  horizonId: string;
  onHorizon: (id: string) => void;
  targetText: string;
  onTargetText: (value: string) => void;
  reads: Map<string, TargetRead>;
  masked: boolean;
}) {
  const dates = evaluation.horizons.filter((horizon) => horizon.shared && !horizon.settlement);
  const priced = evaluation.structures.filter((row): row is PricedStructure => row.status === "priced");
  return (
    <section className={`${labCard} p-4`}>
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">If the target is reached</h2>
          <p className="mt-1 max-w-3xl text-xs text-zinc-700 dark:text-zinc-300" title={COST_PER_DELTA_HINT}>
            Delta, cost per delta, and leverage if spot is at the short call. Expiry uses the settled share count. Earlier dates use the model. {TARGET_LEVERAGE_HINT}
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
              <th className="py-1 pr-3 font-semibold">Leverage if target reached</th>
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
                  <td className="py-1.5 pr-3 tabular-nums">{read ? describeShareDelta(read.positionDelta, read.capped) : "—"}</td>
                  <td className="py-1.5 pr-3" title={COST_PER_DELTA_HINT}>
                    {read ? costPerDeltaLine(read) : "—"}
                  </td>
                  <td className="py-1.5 pr-3 tabular-nums" title={TARGET_LEVERAGE_HINT}>
                    {read == null ? "—" : read.capped || read.leverageAtTarget == null ? CAPPED_DELTA : `${read.leverageAtTarget.toFixed(2)}×`}
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

function HorizonChip({ on, onClick, label }: { on: boolean; onClick: () => void; label: string }) {
  return (
    <button
      type="button"
      aria-pressed={on}
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

