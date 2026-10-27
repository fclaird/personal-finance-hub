"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatSignedUsd2 } from "@/lib/format";
import type { IsoDate } from "@/lib/optionChain/chain";
import {
  bookUnderlyings,
  buildUnderlyingTree,
  nodeState,
  selectionCost,
  toggleUnderlyingLegs,
  type BookLeg,
  type BookNode,
  type CheckState,
} from "@/lib/strategyLab/bookCost";
import type { LabEdit, StructureSpec } from "@/lib/strategyLab/lab";
import { labCard, labControl, labLabel } from "@/lib/strategyLab/palette";

type BookResponse = {
  readonly ok?: boolean;
  readonly error?: string;
  readonly legs?: BookLeg[];
};

function TriBox({
  state,
  label,
  onToggle,
}: {
  state: CheckState;
  label: string;
  onToggle: () => void;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = state === "mixed";
  }, [state]);
  return (
    <label className="inline-flex min-w-0 items-center gap-2 text-sm text-zinc-100">
      <input
        ref={ref}
        type="checkbox"
        checked={state === "on"}
        onChange={onToggle}
        aria-label={label}
        className="h-4 w-4 accent-zinc-100"
      />
      <span className="min-w-0">{label}</span>
    </label>
  );
}

function TreeRows({
  node,
  depth,
  selected,
  open,
  onToggle,
  onOpen,
}: {
  node: BookNode;
  depth: number;
  selected: ReadonlySet<string>;
  open: ReadonlySet<string>;
  onToggle: (legIds: readonly string[]) => void;
  onOpen: (id: string) => void;
}) {
  const expanded = open.has(node.id);
  const missing = node.kind === "leg" && node.label.includes("no cost basis");
  return (
    <div>
      <div className="flex items-start gap-1 py-0.5" style={{ paddingLeft: depth * 16 }}>
        {node.children.length > 0 ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={`${expanded ? "Collapse" : "Expand"} ${node.label}`}
            onClick={() => onOpen(node.id)}
            className="mt-0.5 w-5 shrink-0 text-sm font-semibold text-zinc-100"
          >
            {expanded ? "▾" : "▸"}
          </button>
        ) : (
          <span className="w-5 shrink-0" />
        )}
        <TriBox state={nodeState(node.legIds, selected)} label={node.label} onToggle={() => onToggle(node.legIds)} />
        {missing ? <span className="mt-0.5 text-xs font-semibold text-amber-200">Flagged</span> : null}
      </div>
      {expanded
        ? node.children.map((child) => (
            <TreeRows
              key={child.id}
              node={child}
              depth={depth + 1}
              selected={selected}
              open={open}
              onToggle={onToggle}
              onOpen={onOpen}
            />
          ))
        : null}
    </div>
  );
}

function defaultOpen(node: BookNode, into: Set<string>, depth: number, total: number) {
  if (depth < 2 || total <= 40) into.add(node.id);
  for (const child of node.children) defaultOpen(child, into, depth + 1, total);
}

function isBookPackage(spec: StructureSpec): boolean {
  return spec.legs.some((leg) => leg.bookPrice != null || leg.manualPrice != null || leg.missingCost);
}

export function BookPicker({
  chainSymbol,
  full,
  structures,
  masked,
  onSave,
  onView,
}: {
  chainSymbol: string | null;
  full: boolean;
  structures: readonly StructureSpec[];
  masked: boolean;
  onSave: (edits: readonly LabEdit[], view: "overlay" | "alone") => void;
  onView: (id: string, view: "overlay" | "alone") => void;
}) {
  const [legs, setLegs] = useState<readonly BookLeg[]>([]);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);
  const [symbol, setSymbol] = useState<string | null>(null);
  const [pending, setPending] = useState<string | null>(null);
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [name, setName] = useState("");
  const [note, setNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch("/api/strategy-lab/book", { cache: "no-store" });
        const body = (await resp.json()) as BookResponse;
        if (cancelled) return;
        if (!resp.ok || body.ok === false) {
          setStatus("error");
          setError(body.error ?? "The book could not be read.");
          setLegs([]);
          return;
        }
        setLegs(body.legs ?? []);
        setStatus("ready");
        setError(null);
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : "The book could not be read.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  const legKey = legs.map((leg) => leg.id).join("\n");
  const [syncedKey, setSyncedKey] = useState(legKey);
  const [openedFor, setOpenedFor] = useState<string | null>(null);
  if (syncedKey !== legKey) {
    setSyncedKey(legKey);
    const liveSymbols = new Set(legs.map((leg) => leg.underlying));
    const liveIds = new Set(legs.map((leg) => leg.id));
    setSymbol((prev) => (prev && liveSymbols.has(prev) ? prev : null));
    setSelected((prev) => new Set([...prev].filter((id) => liveIds.has(id))));
    setPending(null);
  }
  if (symbol !== openedFor) {
    setOpenedFor(symbol);
    if (!symbol) {
      setOpen(new Set());
    } else {
      const opened = buildUnderlyingTree(legs, symbol);
      const next = new Set<string>();
      defaultOpen(opened, next, 0, opened.legIds.length);
      setOpen(next);
    }
  }

  const rows = useMemo(() => bookUnderlyings(legs), [legs]);
  const tree = useMemo(() => (symbol ? buildUnderlyingTree(legs, symbol) : null), [legs, symbol]);
  const summary = selectionCost(legs, selected);
  const packages = structures.filter((spec) => {
    if (!symbol || !isBookPackage(spec)) return false;
    return (spec.underlying ?? chainSymbol) === symbol;
  });

  function choose(next: string) {
    if (next === symbol) {
      setPending(null);
      return;
    }
    if (selected.size === 0) {
      setSymbol(next);
      setPending(null);
      setNote(null);
      return;
    }
    setPending(next);
  }

  function confirmSwitch() {
    if (!pending) return;
    setSymbol(pending);
    setSelected(new Set());
    setPending(null);
    setNote(null);
  }

  function save(view: "overlay" | "alone") {
    const chosen = legs.filter((leg) => selected.has(leg.id));
    if (chosen.length === 0 || !symbol) {
      setNote("Select one underlying, then at least one leg.");
      return;
    }
    const symbols = new Set(chosen.map((leg) => leg.underlying));
    if (symbols.size !== 1 || !symbols.has(symbol)) {
      setNote("A package is one underlying. Narrow the selection.");
      return;
    }
    if (!chainSymbol) {
      setNote(`Load ${symbol} to price this package.`);
      return;
    }
    if (symbol !== chainSymbol) {
      setNote(`Load ${symbol} to price this package. The chain is ${chainSymbol}.`);
      return;
    }
    if (full) {
      setNote("The lab is full. Remove a structure, then save this package.");
      return;
    }
    const label = name.trim().slice(0, 40) || `${symbol} book`;
    onSave(
      [
        { kind: "setBasis", basis: { kind: "perPackage" } },
        {
          kind: "savePackage",
          label,
          underlying: symbol,
          legs: chosen.map((leg) => ({
            instrument: leg.instrument,
            right: leg.right,
            strike: leg.strike,
            ratio: leg.quantity,
            expiry: leg.expiry,
            bookPrice: leg.bookPrice,
            bookDate: leg.bookDate as IsoDate | null,
            manualPrice: null,
            manualDate: null,
            missingCost: leg.missingCost,
          })),
        },
      ],
      view,
    );
    setNote(`Saved ${label}. ${view === "alone" ? "Showing it alone." : "Added to the overlay."}`);
  }

  return (
    <section className={`${labCard} p-4`} data-book-picker="">
      <h2 className="text-sm font-semibold text-zinc-50">From the book</h2>
      <p className={`mt-1 mb-3 ${labLabel}`}>
        Pick one underlying, then check an account, expiry, or leg. A package stays on that ticker, so the price axis stays meaningful. Cost and
        fill date come from the trade history, then the position average. Nothing here places an order.
      </p>
      {status === "loading" ? <p className="text-sm text-zinc-200">Reading the book…</p> : null}
      {status === "error" ? (
        <p className="text-sm text-zinc-100">
          The book is not loaded. {error}{" "}
          <button type="button" className="font-semibold text-zinc-50 underline" onClick={() => setAttempt((value) => value + 1)}>
            Try again
          </button>
        </p>
      ) : null}
      {status === "ready" ? (
        <>
          {rows.length === 0 ? <p className="text-sm text-zinc-200">No open equity or option legs.</p> : null}
          {rows.length > 0 ? (
            <div
              role="group"
              aria-label="Underlying"
              data-book-underlyings=""
              className="mb-3 rounded-lg border border-zinc-400 bg-zinc-950 p-2 dark:[color-scheme:dark]"
            >
              {rows.map((row) => {
                const active = symbol === row.symbol;
                const count = `${row.legCount} ${row.legCount === 1 ? "leg" : "legs"}`;
                const accounts = row.accounts.join(", ");
                return (
                  <label key={row.symbol} className="flex min-w-0 items-center gap-2 py-0.5 text-sm text-zinc-100">
                    <input
                      type="checkbox"
                      checked={active}
                      onChange={() => choose(row.symbol)}
                      aria-label={`${row.symbol}, ${count}, ${accounts}`}
                      data-underlying={row.symbol}
                      data-active={active ? "true" : "false"}
                      className="h-4 w-4 accent-zinc-100"
                    />
                    <span className="font-semibold">{row.symbol}</span>
                    <span className="text-zinc-200">
                      {count} · {accounts}
                    </span>
                  </label>
                );
              })}
            </div>
          ) : null}
          {pending ? (
            <div className="mb-3 rounded-lg border border-zinc-400 bg-zinc-950 p-3 text-sm text-zinc-100">
              <p>
                Switch to {pending}? This clears {summary.count} checked {summary.count === 1 ? "leg" : "legs"}.
              </p>
              <div className="mt-2 flex gap-2">
                <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={confirmSwitch}>
                  Switch
                </button>
                <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => setPending(null)}>
                  Stay
                </button>
              </div>
            </div>
          ) : null}
          {symbol && tree ? (
            <>
              <div className="mb-3 flex flex-wrap items-end gap-2">
                <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => setSelected(new Set(tree.legIds))}>
                  Select all
                </button>
                <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => setSelected(new Set())}>
                  Clear
                </button>
                <p className="pb-1 text-sm font-semibold tabular-nums text-zinc-50" data-book-count={summary.count} data-book-net={summary.net}>
                  {summary.count} {summary.count === 1 ? "leg" : "legs"}
                  {summary.priced > 0 ? ` · net cost basis ${formatSignedUsd2(summary.net, { mask: masked })}` : ""}
                </p>
                {summary.missing > 0 ? (
                  <p className="pb-1 text-sm font-semibold text-amber-200">
                    {summary.missing} {summary.missing === 1 ? "leg has" : "legs have"} no cost basis
                  </p>
                ) : null}
              </div>
              <div className="max-h-80 overflow-auto rounded-lg border border-zinc-400 bg-zinc-950 p-2 dark:[color-scheme:dark]">
                <TreeRows
                  node={tree}
                  depth={0}
                  selected={selected}
                  open={open}
                  onToggle={(legIds) => setSelected((prev) => toggleUnderlyingLegs(legs, prev, legIds))}
                  onOpen={(id) =>
                    setOpen((prev) => {
                      const next = new Set(prev);
                      if (next.has(id)) next.delete(id);
                      else next.add(id);
                      return next;
                    })
                  }
                />
              </div>
            </>
          ) : rows.length > 0 ? (
            <p className="text-sm text-zinc-200">Choose an underlying…</p>
          ) : null}
          <div className="mt-3 flex flex-wrap items-end gap-2">
            <label className={labLabel}>
              Package name
              <input
                aria-label="Package name"
                value={name}
                onChange={(event) => setName(event.target.value)}
                placeholder="TSLA summer"
                className={`mt-1 block w-48 px-2 py-1.5 text-sm ${labControl}`}
              />
            </label>
            <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => save("overlay")}>
              Save and overlay
            </button>
            <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => save("alone")}>
              Save alone
            </button>
          </div>
          {note ? <p className="mt-2 text-sm text-zinc-100">{note}</p> : null}
          {packages.length > 0 ? (
            <ul className="mt-3 space-y-1">
              {packages.map((spec) => (
                <li key={spec.id} className="flex flex-wrap items-center gap-2 text-sm text-zinc-100">
                  <span className="font-semibold">{spec.label}</span>
                  <button type="button" className={`px-2 py-1 text-xs font-semibold ${labControl}`} onClick={() => onView(spec.id, "overlay")}>
                    Overlay
                  </button>
                  <button type="button" className={`px-2 py-1 text-xs font-semibold ${labControl}`} onClick={() => onView(spec.id, "alone")}>
                    Alone
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}
    </section>
  );
}
