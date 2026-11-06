"use client";

import { useCallback, useEffect, useState } from "react";

import { formatUsd2 } from "@/lib/format";
import type { LabEdit } from "@/lib/strategyLab/lab";
import { labCard, labControl, labLabel } from "@/lib/strategyLab/palette";
import {
  draftHeldBook,
  heldAccountChoices,
  type HeldAccountChoice,
  type HeldAccountRef,
  type HeldPositionRow,
} from "@/lib/strategyLab/positionsImport";

type Snapshot = {
  readonly status: "loading" | "ready" | "error";
  readonly positions: readonly HeldPositionRow[];
  readonly accounts: readonly HeldAccountRef[];
  readonly error: string | null;
  readonly retry: () => void;
};

function money(n: number | null, masked: boolean): string {
  if (n == null) return "—";
  return formatUsd2(n, { mask: masked });
}

export function useSchwabPositions(): Snapshot {
  const [status, setStatus] = useState<Snapshot["status"]>("loading");
  const [positions, setPositions] = useState<readonly HeldPositionRow[]>([]);
  const [accounts, setAccounts] = useState<readonly HeldAccountRef[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState(0);

  const retry = useCallback(() => {
    setStatus("loading");
    setError(null);
    setAttempt((value) => value + 1);
  }, []);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch("/api/positions", { cache: "no-store" });
        const body = (await resp.json()) as {
          ok?: boolean;
          error?: string;
          positions?: HeldPositionRow[];
          accounts?: HeldAccountRef[];
        };
        if (cancelled) return;
        if (!resp.ok || body.ok === false) {
          setStatus("error");
          setError(body.error ?? "Positions could not be read.");
          setPositions([]);
          setAccounts([]);
          return;
        }
        setPositions(body.positions ?? []);
        setAccounts(body.accounts ?? []);
        setStatus("ready");
      } catch (e) {
        if (cancelled) return;
        setStatus("error");
        setError(e instanceof Error ? e.message : "Positions could not be read.");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [attempt]);

  return { status, positions, accounts, error, retry };
}

export function HeldPositions({
  symbol,
  masked,
  full,
  snapshot,
  nextStructureId,
  onImport,
}: {
  symbol: string;
  masked: boolean;
  full: boolean;
  snapshot: Snapshot;
  nextStructureId: string | null;
  onImport: (edits: readonly LabEdit[]) => void;
}) {
  const [accountId, setAccountId] = useState<string | null>(null);
  const [loadedId, setLoadedId] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const choices = snapshot.status === "ready" ? heldAccountChoices(snapshot.positions, symbol, snapshot.accounts) : [];
  const selected = choices.find((choice) => choice.id === accountId) ?? null;
  const book =
    selected == null
      ? null
      : draftHeldBook({
          rows: snapshot.positions,
          symbol,
          accountId: selected.id,
          accountLabel: selected.label,
        });

  function loadBook() {
    if (!book || !book.ok) {
      setError(book && !book.ok ? book.error : "Choose an account first.");
      return;
    }
    if (full && loadedId == null) {
      setError("The lab is full. Remove a structure, then load this book.");
      return;
    }
    const edits: LabEdit[] = [{ kind: "setBasis", basis: { kind: "perPackage" } }];
    if (loadedId) edits.push({ kind: "removeStructure", id: loadedId });
    edits.push({
      kind: "importHeld",
      expiry: book.draft.expiry,
      label: book.draft.label,
      legs: book.draft.legs,
      netPerShare: book.draft.netPerShare,
      stock: book.draft.stock,
    });
    onImport(edits);
    if (nextStructureId) setLoadedId(nextStructureId);
    setError(null);
    const shares = book.summary.shares == null ? "" : ` and ${book.summary.shares} shares`;
    setNote(`Loaded ${book.draft.label}: ${book.summary.legs} legs${shares}. The main charts use this book.`);
  }

  return (
    <section className={`${labCard} p-4`} data-held-positions="">
      <h2 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Held positions</h2>
      <p className={`mt-1 mb-3 ${labLabel}`}>
        Schwab positions load in the background. They stay off the charts until you pick an account, or all accounts, and load that book.
        Average cost is the entry. Nothing here places an order.
      </p>
      {snapshot.status === "loading" ? <p className="text-sm text-zinc-300">Reading positions…</p> : null}
      {snapshot.status === "error" ? (
        <p className="text-sm text-zinc-200">
          Positions are not loaded. {snapshot.error}{" "}
          <button type="button" className="font-semibold text-zinc-50 underline" onClick={snapshot.retry}>
            Try again
          </button>
        </p>
      ) : null}
      {snapshot.status === "ready" && choices.length === 0 ? (
        <p className="text-sm text-zinc-200">No open option positions for {symbol}.</p>
      ) : null}
      {choices.length > 0 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Held account">
          {choices.map((choice) => (
            <AccountChip key={choice.id} choice={choice} pressed={accountId === choice.id} onPick={() => setAccountId(choice.id)} />
          ))}
        </div>
      ) : null}
      {error ? <p className="mt-2 text-sm text-rose-300">{error}</p> : null}
      {note ? <p className="mt-2 text-sm text-zinc-200">{note}</p> : null}
      {selected && book?.ok ? (
        <div className="mt-3 rounded-lg border border-zinc-400 bg-zinc-900 p-3" data-held-book={selected.id}>
          <p className="text-sm font-semibold text-zinc-50">{selected.id === "all" ? "All accounts" : selected.label}</p>
          <p className="mt-1 text-sm text-zinc-200">
            {book.summary.legs} legs · {book.summary.contracts} contracts · {book.summary.expiries.length}{" "}
            {book.summary.expiries.length === 1 ? "expiry" : "expiries"}
            {book.summary.shares == null ? "" : ` · ${book.summary.shares} shares at ${money(book.draft.stock?.averagePrice ?? null, masked)}`}
          </p>
          {book.summary.stockOmitted ? (
            <p className="mt-1 text-xs text-amber-200">The shares have no average cost, so the option legs load without them.</p>
          ) : null}
          <button
            type="button"
            disabled={full && loadedId == null}
            className={`mt-3 px-3 py-1.5 text-xs font-semibold ${labControl} disabled:opacity-40`}
            onClick={loadBook}
          >
            Load into analysis
          </button>
          <ul className="mt-3 max-h-64 space-y-1 overflow-auto text-sm text-zinc-100">
            {book.draft.legs.map((leg) => (
              <li key={`${leg.expiry}-${leg.right}-${leg.strike}-${leg.ratio}`} className="tabular-nums">
                {leg.expiry} · {leg.ratio > 0 ? "Long" : "Short"} {Math.abs(leg.ratio)} {leg.right === "C" ? "call" : "put"} {leg.strike}
              </li>
            ))}
            {book.draft.stock ? (
              <li className="tabular-nums">
                Stock · {book.draft.stock.shares} shares at {money(book.draft.stock.averagePrice, masked)}
              </li>
            ) : null}
          </ul>
        </div>
      ) : null}
    </section>
  );
}

function AccountChip({
  choice,
  pressed,
  onPick,
}: {
  choice: HeldAccountChoice;
  pressed: boolean;
  onPick: () => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={pressed}
      onClick={onPick}
      className={`rounded-full px-3 py-1 text-xs font-semibold ${
        pressed ? "bg-zinc-100 text-zinc-950" : "border border-zinc-400 bg-zinc-900 text-zinc-50"
      }`}
    >
      {choice.label}
      <span className="ml-1 tabular-nums opacity-80">{choice.legs}</span>
    </button>
  );
}
