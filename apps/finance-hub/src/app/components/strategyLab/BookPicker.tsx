"use client";

import { useEffect, useMemo, useRef, useState } from "react";

import { formatSignedUsd2 } from "@/lib/format";
import type { IsoDate } from "@/lib/optionChain/chain";
import {
  buildBookTree,
  nodeState,
  selectionCost,
  toggleNode,
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
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [open, setOpen] = useState<ReadonlySet<string>>(() => new Set());
  const [query, setQuery] = useState("");
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
  useEffect(() => {
    const tree = buildBookTree(legs);
    const next = new Set<string>();
    defaultOpen(tree, next, 0, legs.length);
    setOpen(next);
    setSelected((prev) => {
      const live = new Set(legs.map((leg) => leg.id));
      const kept = new Set([...prev].filter((id) => live.has(id)));
      return kept;
    });
  }, [legKey, legs]);

  const filtered = useMemo(() => {
    const q = query.trim().toUpperCase();
    if (!q) return legs;
    return legs.filter((leg) => leg.underlying.includes(q) || leg.accountLabel.toUpperCase().includes(q));
  }, [legs, query]);
  const tree = useMemo(() => buildBookTree(filtered), [filtered]);
  const summary = selectionCost(legs, selected);
  const packages = structures.filter((spec) => spec.legs.some((leg) => leg.bookPrice != null || leg.manualPrice != null || leg.missingCost));

  function save(view: "overlay" | "alone") {
    const chosen = legs.filter((leg) => selected.has(leg.id));
    if (chosen.length === 0) {
      setNote("Select at least one leg.");
      return;
    }
    const symbols = new Set(chosen.map((leg) => leg.underlying));
    if (symbols.size !== 1) {
      setNote("A package is one underlying. Narrow the selection.");
      return;
    }
    const underlying = [...symbols][0]!;
    if (!chainSymbol) {
      setNote(`Load ${underlying} to price this package.`);
      return;
    }
    if (underlying !== chainSymbol) {
      setNote(`Load ${underlying} to price this package. The chain is ${chainSymbol}.`);
      return;
    }
    if (full) {
      setNote("The lab is full. Remove a structure, then save this package.");
      return;
    }
    const label = name.trim().slice(0, 40) || `${underlying} book`;
    onSave(
      [
        { kind: "setBasis", basis: { kind: "perPackage" } },
        {
          kind: "savePackage",
          label,
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
        Check any account, underlying, expiry, or leg. A checked node includes everything under it. Select all checks the whole book.
        Cost and fill date come from the trade history, then the position average. Nothing here places an order.
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
          <div className="mb-3 flex flex-wrap items-end gap-2">
            <label className={labLabel}>
              Symbol
              <input
                aria-label="Filter book by symbol"
                value={query}
                onChange={(event) => setQuery(event.target.value.toUpperCase())}
                placeholder="TSLA"
                className={`mt-1 block w-28 px-2 py-1.5 text-sm font-semibold tracking-wide ${labControl}`}
              />
            </label>
            <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => setSelected(new Set(legs.map((leg) => leg.id)))}>
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
          {filtered.length === 0 ? <p className="text-sm text-zinc-200">No open equity or option legs match.</p> : null}
          <div className="max-h-80 overflow-auto rounded-lg border border-zinc-400 bg-zinc-950 p-2 dark:[color-scheme:dark]">
            <TreeRows
              node={tree}
              depth={0}
              selected={selected}
              open={open}
              onToggle={(legIds) => setSelected((prev) => toggleNode(legIds, prev))}
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
