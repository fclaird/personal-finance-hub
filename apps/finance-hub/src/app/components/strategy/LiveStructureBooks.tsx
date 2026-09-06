"use client";

import { useEffect, useMemo, useState } from "react";

import { SituationLifecycle } from "@/app/components/strategy/SituationLifecycle";
import type { OptionRiskSummary } from "@/lib/alerts/optionRisk";
import { formatUsd2 } from "@/lib/format";
import {
  groupLiveStructureBooks,
  liveBookLinkedToOpenSituation,
  type LiveStructureBook,
  type LiveStructureKind,
} from "@/lib/situations/liveStructures";
import type { SituationView } from "@/lib/situations/apiTypes";

function matchSituation(book: LiveStructureBook, situations: SituationView[]): SituationView | null {
  const open = situations.filter(
    (s) =>
      s.linkStatus !== "rejected" &&
      s.status === "open" &&
      s.accountId === book.accountId &&
      s.underlying.toUpperCase() === book.underlying.toUpperCase() &&
      (book.kind === "short-strangle" ? s.kind === "short-strangle" : s.kind === "butterfly"),
  );
  if (open.length === 0) return null;
  // Prefer the book with the most fills (richest history) when several match.
  return open.slice().sort((a, b) => b.members.length - a.members.length || b.openedOn.localeCompare(a.openedOn))[0]!;
}

function strikeLabel(book: LiveStructureBook): string {
  const puts = book.legs.filter((l) => l.right === "P" && l.strike != null).map((l) => l.strike!);
  const calls = book.legs.filter((l) => l.right === "C" && l.strike != null).map((l) => l.strike!);
  const put = puts.length ? Math.min(...puts) : null;
  const call = calls.length ? Math.max(...calls) : null;
  if (put != null && call != null) return `${put}/${call}`;
  if (put != null) return `${put}P`;
  if (call != null) return `${call}C`;
  return "";
}

export function LiveStructureBooks({
  kind,
  situations,
  privacyMasked,
  onRefreshLinks,
  refreshingLinks = false,
}: {
  kind: "short-strangles" | "butterflies";
  situations: SituationView[];
  privacyMasked: boolean;
  onRefreshLinks?: () => void;
  refreshingLinks?: boolean;
}) {
  const liveKind: LiveStructureKind = kind === "short-strangles" ? "short-strangle" : "butterfly";
  const noun = kind === "short-strangles" ? "strangles" : "butterflies";
  const [summary, setSummary] = useState<OptionRiskSummary | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch("/api/option-risk", { cache: "no-store" });
        const json = (await resp.json()) as OptionRiskSummary & { ok?: boolean };
        if (!cancelled && json.ok) {
          setSummary({
            positions: json.positions ?? [],
            undefinedRiskCount: json.undefinedRiskCount ?? 0,
            nakedShortCount: json.nakedShortCount ?? 0,
            marginPressure: json.marginPressure ?? [],
          });
        }
      } catch {
        /* live books are best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const books = useMemo(
    () => groupLiveStructureBooks(summary?.positions ?? [], liveKind),
    [summary, liveKind],
  );

  function toggle(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  if (!summary || books.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Live {noun}</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Click a card for trade history (open → adjustments → current). Snapshot legs above the fold.
        </p>
      </div>
      <div className="grid gap-2">
        {books.map((b) => {
          const linked = liveBookLinkedToOpenSituation(b, situations);
          const situation = matchSituation(b, situations);
          const isOpen = expanded.has(b.key);
          const strikes = strikeLabel(b);

          return (
            <article
              key={b.key}
              className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-white/15 dark:bg-zinc-950"
            >
              <button
                type="button"
                onClick={() => toggle(b.key)}
                className="flex w-full flex-wrap items-baseline justify-between gap-2 px-3 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-white/5"
                aria-expanded={isOpen}
              >
                <div className="min-w-0">
                  <div className="flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100">
                    <span className="text-zinc-400" aria-hidden>
                      {isOpen ? "▾" : "▸"}
                    </span>
                    <span>
                      {b.underlying} {b.kind.replace(/-/g, " ")}
                      {strikes ? ` ${strikes}` : ""}
                    </span>
                  </div>
                  <div className="pl-5 text-xs text-zinc-500">
                    {b.accountName}
                    {b.expiration ? ` · ${b.expiration}` : ""}
                    {b.dte != null ? ` · ${b.dte} DTE` : ""}
                    {situation
                      ? ` · ${situation.members.length} fills · opened ${situation.openedOn}`
                      : linked
                        ? " · linked"
                        : " · no linked trade history yet"}
                    {isOpen ? " · hide history" : " · show history"}
                  </div>
                </div>
                <div className="flex flex-col items-end gap-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Snapshot</span>
                  {situation?.netPremium != null ? (
                    <span className="text-xs tabular-nums text-zinc-600 dark:text-zinc-300">
                      Net {formatUsd2(situation.netPremium, { mask: privacyMasked })}
                    </span>
                  ) : null}
                </div>
              </button>

              <ul className="space-y-1 border-t border-zinc-100 px-3 py-2 text-xs dark:border-white/10">
                {b.legs.map((leg) => (
                  <li key={leg.positionId} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-zinc-700 dark:text-zinc-200">
                      {leg.quantity} {leg.right}
                      {leg.strike != null ? ` ${leg.strike}` : ""}
                    </span>
                    <span className="text-zinc-500">
                      {leg.flags.structure === "short-strangle" ? "strangle" : leg.flags.structure.replace(/-/g, " ")}
                      {leg.flags.maxLoss === "unbounded" ? " · unbounded" : ""}
                      {leg.delta != null ? ` · Δ ${leg.delta.toFixed(2)}` : ""}
                      {leg.intrinsic != null && leg.intrinsic > 0
                        ? ` · ITM ${formatUsd2(leg.intrinsic, { mask: privacyMasked })}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>

              {isOpen ? (
                situation ? (
                  <SituationLifecycle row={situation} privacyMasked={privacyMasked} />
                ) : (
                  <div className="border-t border-zinc-100 px-3 py-3 text-xs text-zinc-600 dark:border-white/10 dark:text-zinc-400">
                    <p>
                      No linked TRADE history for this live book yet. Refresh links to rebuild open → roll → close trees
                      from Schwab fills.
                    </p>
                    {onRefreshLinks ? (
                      <button
                        type="button"
                        onClick={() => onRefreshLinks()}
                        disabled={refreshingLinks}
                        className="mt-2 rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5"
                      >
                        {refreshingLinks ? "Linking…" : "Refresh links"}
                      </button>
                    ) : null}
                  </div>
                )
              ) : null}
            </article>
          );
        })}
      </div>
    </div>
  );
}
