"use client";

import { formatExpiryLabel, listedStrikes, type OptionChain } from "@/lib/optionChain/chain";
import { formatNum, formatSignedUsd2, formatUsd2 } from "@/lib/format";
import type { LabEdit, StructureEval } from "@/lib/strategyLab/lab";

function usd(n: number | null | undefined, mask: boolean): string {
  return formatUsd2(n, { mask });
}

function signed(n: number | null | undefined, mask: boolean): string {
  return formatSignedUsd2(n, { mask });
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500">{label}</div>
      <div className="truncate text-sm tabular-nums font-medium">{value}</div>
    </div>
  );
}

export function StructureCard({
  chain,
  row,
  masked,
  onEdit,
}: {
  chain: OptionChain;
  row: StructureEval;
  masked: boolean;
  onEdit: (edit: LabEdit) => void;
}) {
  const spec = row.spec;
  const strikesFor = (index: number) => {
    const leg = spec.legs[index];
    if (!leg) return [];
    return listedStrikes(chain, spec.expiry, leg.right);
  };

  return (
    <article className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-950">
      <div className="mb-3 flex items-center justify-between gap-2">
        <input
          aria-label={`${spec.label} name`}
          value={spec.label}
          onChange={(e) => onEdit({ kind: "setLabel", id: spec.id, label: e.target.value })}
          className="w-40 rounded border border-zinc-300 bg-transparent px-2 py-1 text-sm font-semibold dark:border-white/20"
        />
        <button
          type="button"
          onClick={() => onEdit({ kind: "removeStructure", id: spec.id })}
          className="text-xs font-medium text-zinc-500 hover:text-rose-600"
        >
          Remove
        </button>
      </div>

      <label className="mb-3 block text-xs text-zinc-500">
        Expiry
        <select
          aria-label={`${spec.label} expiry`}
          value={spec.expiry}
          onChange={(e) => onEdit({ kind: "setExpiry", id: spec.id, expiry: e.target.value as typeof spec.expiry })}
          className="mt-1 block w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
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
          <label className="min-w-0 flex-1 text-xs text-zinc-500">
            {leg.ratio > 0 ? "Long" : "Short"} {Math.abs(leg.ratio)}× {leg.right === "C" ? "call" : "put"}
            <select
              aria-label={`${spec.label} leg ${index + 1} strike`}
              value={String(leg.strike)}
              onChange={(e) => onEdit({ kind: "setStrike", id: spec.id, legIndex: index, strike: Number(e.target.value) })}
              className="mt-1 block w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm tabular-nums dark:border-white/20"
            >
              {strikesFor(index).map((strike) => (
                <option key={strike} value={strike}>
                  {strike}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            aria-label={`${spec.label} leg ${index + 1} down`}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-white/20"
            onClick={() => onEdit({ kind: "stepStrike", id: spec.id, legIndex: index, steps: -1 })}
          >
            −
          </button>
          <button
            type="button"
            aria-label={`${spec.label} leg ${index + 1} up`}
            className="rounded border border-zinc-300 px-2 py-1.5 text-sm dark:border-white/20"
            onClick={() => onEdit({ kind: "stepStrike", id: spec.id, legIndex: index, steps: 1 })}
          >
            +
          </button>
        </div>
      ))}

      <fieldset className="mb-3 mt-3 text-xs text-zinc-500">
        <legend className="mb-1">Entry</legend>
        <div className="flex flex-wrap items-center gap-3 text-sm text-zinc-800 dark:text-zinc-100">
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
              className="w-24 rounded border border-zinc-300 bg-transparent px-2 py-1 tabular-nums dark:border-white/20"
            />
          </label>
        </div>
      </fieldset>

      {row.status === "blocked" ? (
        <p className="text-sm text-rose-600">{row.reason}</p>
      ) : (
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
                : row.sizing.status === "perPackage"
                  ? "1"
                  : formatNum(row.sizing.packages, Number.isInteger(row.sizing.packages) ? 0 : 2)
            }
          />
          <Stat label="Idle cash" value={row.sizing.status === "sized" ? usd(row.sizing.idleCash, masked) : usd(0, masked)} />
          <Stat
            label="Leverage"
            value={
              row.sizing.status !== "needsCapitalOverride" && row.sizing.leverage != null
                ? `${row.sizing.leverage.toFixed(2)}x`
                : "—"
            }
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
      )}
    </article>
  );
}
