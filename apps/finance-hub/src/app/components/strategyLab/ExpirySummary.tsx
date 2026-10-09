"use client";

import { formatExpiryLabel } from "@/lib/optionChain/chain";
import { formatSignedUsd2 } from "@/lib/format";
import {
  capitalExpiryPnl,
  describeSpotCallout,
  describeZone,
  zoneContaining,
  type ExpiryBoard,
  type LabEdit,
  type LabEvaluation,
  type PricedStructure,
} from "@/lib/strategyLab/lab";

const SERIES = ["#059669", "#0891b2", "#d97706", "#7c3aed"];

function money(n: number | null, mask: boolean): string {
  if (n == null) return "—";
  return formatSignedUsd2(n, { mask });
}

function Row({
  label,
  pnl,
  winner,
  color,
  mask,
}: {
  label: string;
  pnl: number | null;
  winner: boolean;
  color: string;
  mask: boolean;
}) {
  return (
    <li
      className={`flex items-center justify-between gap-3 rounded px-2 py-1 tabular-nums ${winner ? "bg-emerald-50 font-semibold dark:bg-emerald-950/40" : ""}`}
    >
      <span className="inline-flex items-center gap-2">
        <span className="inline-block h-2 w-2 rounded-full" style={{ background: color }} />
        {label}
        {winner ? <span className="text-[10px] font-semibold uppercase tracking-wide text-emerald-700">Ahead</span> : null}
      </span>
      <span>{money(pnl, mask)}</span>
    </li>
  );
}

function BoardLines({ board }: { board: ExpiryBoard }) {
  return (
    <div>
      {board.note ? <p className="mb-1 text-xs text-amber-800 dark:text-amber-200">{board.note}</p> : null}
      <ul className="space-y-1 text-sm text-zinc-800 dark:text-zinc-100">
        {board.zones.map((zone) => (
          <li key={`${zone.lo}-${zone.hi ?? "inf"}-${zone.bestId}`}>{describeZone(zone)}</li>
        ))}
      </ul>
    </div>
  );
}

export function ExpirySummary({
  evaluation,
  masked,
  compareStock,
  whatIfSpot,
  onWhatIf,
  onEdit,
}: {
  evaluation: LabEvaluation;
  masked: boolean;
  compareStock: boolean;
  whatIfSpot: number;
  onWhatIf: (spot: number) => void;
  onEdit: (edit: LabEdit) => void;
}) {
  const boards = evaluation.expiryBoards;
  const priced = evaluation.structures.filter((row): row is PricedStructure => row.status === "priced");
  if (boards.length === 0 || priced.length === 0) return null;

  const crosses = boards.flatMap((board) => board.crossovers.map((crossover) => crossover.spot));
  const hi = Math.max(evaluation.spot * 2, ...(crosses.length ? [Math.max(...crosses) * 1.08] : [evaluation.spot * 2]));
  const lo = Math.min(evaluation.spot * 0.7, whatIfSpot);
  const capital = evaluation.basis.kind === "equalCapital" ? evaluation.basis.capital : evaluation.spot * 100;

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-950">
      <h2 className="text-sm font-semibold text-zinc-900 dark:text-zinc-50">At expiry, best strategy by price</h2>
      <p className="mt-1 text-xs text-zinc-500">{evaluation.metric}</p>
      <div className="mt-3 space-y-3">
        {boards.map((board) => (
          <div key={board.expiry}>
            {boards.length > 1 ? (
              <h3 className="mb-1 text-xs font-semibold uppercase tracking-wide text-zinc-500">{formatExpiryLabel(board.expiry)}</h3>
            ) : null}
            <BoardLines board={board} />
            {zoneContaining(board.zones, evaluation.spot) ? (
              <p className="mt-2 text-sm font-medium text-zinc-900 dark:text-zinc-50">
                {describeSpotCallout(zoneContaining(board.zones, evaluation.spot)!, evaluation.spot)}
              </p>
            ) : null}
          </div>
        ))}
      </div>

      <div className="mt-4 flex flex-wrap items-end gap-4 border-t border-zinc-200 pt-3 dark:border-white/10">
        <label className="text-xs text-zinc-500">
          Spot at expiry
          <span className="mt-1 flex items-center gap-2">
            <input
              aria-label="Spot at expiry"
              type="range"
              min={lo}
              max={hi}
              step={0.01}
              value={Math.min(hi, Math.max(lo, whatIfSpot))}
              onChange={(e) => onWhatIf(Number(e.target.value))}
              className="w-40"
            />
            <input
              aria-label="Spot at expiry dollars"
              type="number"
              step={0.01}
              value={whatIfSpot}
              onChange={(e) => {
                const next = Number(e.target.value);
                if (Number.isFinite(next) && next >= 0) onWhatIf(next);
              }}
              className="w-24 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm tabular-nums dark:border-white/20"
            />
          </span>
        </label>
        <label className="text-xs text-zinc-500">
          Capital
          <input
            aria-label="What-if capital"
            type="number"
            min={1}
            step={100}
            value={evaluation.basis.kind === "equalCapital" ? evaluation.basis.capital : capital}
            onChange={(e) => {
              const next = Number(e.target.value);
              if (!Number.isFinite(next) || next <= 0) return;
              const units = evaluation.basis.kind === "equalCapital" ? evaluation.basis.units : "whole";
              onEdit({ kind: "setBasis", basis: { kind: "equalCapital", capital: next, units } });
            }}
            className="mt-1 block w-28 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm tabular-nums dark:border-white/20"
          />
        </label>
        <label className="inline-flex items-center gap-2 pb-1 text-xs text-zinc-600 dark:text-zinc-300">
          <input
            type="checkbox"
            checked={compareStock}
            onChange={(e) => onEdit({ kind: "setCompareStock", compare: e.target.checked })}
          />
          Include stock baseline
        </label>
      </div>

      <div className="mt-3 grid gap-3 sm:grid-cols-2">
        {boards.map((board) => {
          const zone = zoneContaining(board.zones, whatIfSpot);
          const ids = new Set(board.structureIds);
          return (
            <div key={`what-${board.expiry}`}>
              <p className="mb-1 text-xs text-zinc-500">
                P&amp;L if spot ends at ${whatIfSpot.toFixed(2)}
                {boards.length > 1 ? ` · ${formatExpiryLabel(board.expiry)}` : ""}
                {zone ? ` · ${describeSpotCallout(zone, whatIfSpot).split(": ").slice(1).join(": ")}` : ""}
              </p>
              <ul className="text-sm">
                {priced
                  .filter((row) => ids.has(row.spec.id))
                  .map((row) => (
                    <Row
                      key={row.spec.id}
                      label={row.spec.label}
                      pnl={capitalExpiryPnl(row, whatIfSpot)}
                      winner={zone?.bestId === row.spec.id && !zone.tied}
                      color={SERIES[row.spec.slot] ?? SERIES[0]!}
                      mask={masked}
                    />
                  ))}
                {compareStock && ids.has("stock") ? (
                  <Row
                    label="Stock"
                    pnl={((whatIfSpot - evaluation.spot) / evaluation.spot) * capital}
                    winner={zone?.bestId === "stock" && !zone.tied}
                    color="#71717a"
                    mask={masked}
                  />
                ) : null}
              </ul>
            </div>
          );
        })}
      </div>
    </section>
  );
}
