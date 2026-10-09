"use client";

import { useState } from "react";

import { formatUsd2 } from "@/lib/format";
import type { LabEdit } from "@/lib/strategyLab/lab";
import { labCard, labControl, labLabel } from "@/lib/strategyLab/palette";
import {
  booksFor,
  draftHeldStructure,
  groupHeldPositions,
  stockFor,
  type HeldBook,
  type HeldGroups,
  type HeldPositionRow,
} from "@/lib/strategyLab/positionsImport";

function money(n: number | null, masked: boolean): string {
  if (n == null) return "—";
  return formatUsd2(n, { mask: masked });
}

export function HeldPositions({
  symbol,
  masked,
  full,
  onImport,
}: {
  symbol: string;
  masked: boolean;
  full: boolean;
  onImport: (edits: readonly LabEdit[]) => void;
}) {
  const [groups, setGroups] = useState<HeldGroups | null>(null);
  const [picked, setPicked] = useState<Record<string, boolean[]>>({});
  const [withStock, setWithStock] = useState<Record<string, boolean>>({});
  const [chartSize, setChartSize] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  const books = groups ? booksFor(groups, symbol) : [];
  const stock = groups ? stockFor(groups, symbol) : null;

  async function loadPositions() {
    setLoading(true);
    setError(null);
    setNote(null);
    try {
      const resp = await fetch("/api/positions", { cache: "no-store" });
      const body = (await resp.json()) as { ok?: boolean; error?: string; positions?: HeldPositionRow[] };
      if (!resp.ok || body.ok === false) {
        setError(body.error ?? "Positions could not be read.");
        return;
      }
      const next = groupHeldPositions(body.positions ?? []);
      setGroups(next);
      const initial: Record<string, boolean[]> = {};
      const shares: Record<string, boolean> = {};
      for (const book of booksFor(next, symbol)) {
        initial[book.key] = book.legs.map(() => true);
        const held = stockFor(next, symbol);
        shares[book.key] = Boolean(held && held.shares > 0 && book.legs.some((leg) => leg.right === "C" && leg.quantity < 0));
      }
      setPicked(initial);
      setWithStock(shares);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Positions could not be read.");
    } finally {
      setLoading(false);
    }
  }

  function importBook(book: HeldBook) {
    const flags = picked[book.key] ?? book.legs.map(() => true);
    const indexes = book.legs.map((_, index) => index).filter((index) => flags[index]);
    const draft = draftHeldStructure({
      book,
      legIndexes: indexes,
      stock,
      includeStock: withStock[book.key] ?? false,
    });
    if (!draft.ok) {
      setError(draft.error);
      return;
    }
    const edits: LabEdit[] = [];
    if (chartSize) edits.push({ kind: "setBasis", basis: { kind: "perPackage" } });
    edits.push({
      kind: "importHeld",
      expiry: draft.draft.expiry,
      label: draft.draft.label,
      legs: draft.draft.legs,
      netPerShare: draft.draft.netPerShare,
      stock: draft.draft.stock,
    });
    onImport(edits);
    setError(null);
    setNote(`Loaded ${draft.draft.label} at average cost. Copy it to compare a different strike.`);
  }

  return (
    <section className={`${labCard} p-4`}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Held positions</h2>
        <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => void loadPositions()}>
          {loading ? "Reading" : groups ? "Refresh positions" : "Read open positions"}
        </button>
      </div>
      <p className={`mb-3 ${labLabel}`}>
        Open options for {symbol}, grouped by expiry. Loading uses average cost, not the mid, and does not write the strategies ledger.
        A covered call needs the share leg.
      </p>
      {error ? <p className="mb-2 text-sm text-rose-400">{error}</p> : null}
      {note ? <p className="mb-2 text-sm text-zinc-200">{note}</p> : null}
      {groups && books.length === 0 ? <p className="text-sm text-zinc-200">No open option positions for {symbol}.</p> : null}
      {groups && groups.unparsed > 0 ? (
        <p className="mb-2 text-sm text-amber-200">{groups.unparsed} option symbol could not be parsed and was left out.</p>
      ) : null}
      {groups && groups.oversized > 0 ? (
        <p className="mb-2 text-sm text-amber-200">{groups.oversized} leg above 100 contracts was left out.</p>
      ) : null}
      {books.map((book) => {
        const flags = picked[book.key] ?? book.legs.map(() => true);
        const include = withStock[book.key] ?? false;
        return (
          <fieldset key={book.key} className="mb-3 rounded-lg border border-zinc-500 p-3">
            <legend className="px-1 text-xs font-semibold text-zinc-200">
              {book.expiry}
              {book.accountCount > 1 ? ` · ${book.accountCount} accounts` : ""}
            </legend>
            <ul className="mb-2 space-y-1">
              {book.legs.map((leg, index) => (
                <li key={`${book.key}-${index}`}>
                  <label className="flex items-center gap-2 text-sm text-zinc-50">
                    <input
                      type="checkbox"
                      checked={flags[index] ?? true}
                      aria-label={`${book.expiry} ${leg.right} ${leg.strike}`}
                      onChange={(event) => {
                        const next = [...flags];
                        next[index] = event.target.checked;
                        setPicked((prev) => ({ ...prev, [book.key]: next }));
                      }}
                    />
                    <span>
                      {leg.quantity > 0 ? "Long" : "Short"} {Math.abs(leg.quantity)} {leg.right === "C" ? "call" : "put"} {leg.strike}
                    </span>
                    <span className="tabular-nums text-zinc-300">avg {money(leg.averagePrice, masked)}</span>
                  </label>
                </li>
              ))}
            </ul>
            {stock ? (
              <label className="mb-2 flex items-center gap-2 text-sm text-zinc-50">
                <input
                  type="checkbox"
                  checked={include}
                  aria-label={`Include ${stock.shares} shares`}
                  onChange={(event) => setWithStock((prev) => ({ ...prev, [book.key]: event.target.checked }))}
                />
                <span>
                  Include {stock.shares} shares at {money(stock.averagePrice, masked)}
                </span>
              </label>
            ) : (
              <p className="mb-2 text-xs text-zinc-300">No share position in this snapshot. Add a stock leg on the card if this is a covered call.</p>
            )}
            <label className="mb-2 flex items-center gap-2 text-sm text-zinc-50">
              <input type="checkbox" checked={chartSize} onChange={(event) => setChartSize(event.target.checked)} />
              Chart at this size (per package)
            </label>
            <button
              type="button"
              disabled={full}
              className={`px-3 py-1.5 text-xs font-semibold ${labControl} disabled:opacity-40`}
              onClick={() => importBook(book)}
            >
              Load into lab
            </button>
          </fieldset>
        );
      })}
    </section>
  );
}
