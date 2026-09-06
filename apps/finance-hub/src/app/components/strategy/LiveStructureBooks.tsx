"use client";

import { useEffect, useMemo, useState } from "react";

import { SituationLifecycle, pnlTone } from "@/app/components/strategy/SituationLifecycle";
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
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Live {noun}</h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-300">
          Click a card for trade history (open → adjustments → current). Snapshot legs above the fold.
        </p>
      </div>

      {/* Left: tightened books · Right: reserved risk-profile column */}
      <div className="flex flex-col gap-3 lg:flex-row lg:items-start">
        <div className="min-w-0 w-full max-w-3xl flex-1 space-y-0 divide-y divide-zinc-300 dark:divide-white/25 lg:max-w-[60%]">
          {books.map((b) => {
            const linked = liveBookLinkedToOpenSituation(b, situations);
            const situation = matchSituation(b, situations);
            const isOpen = expanded.has(b.key);
            const strikes = strikeLabel(b);
            // Live books are open structures — snapshot net is unrealized → grey.
            const snapshotRealized = false;

            return (
              <article
                key={b.key}
                className="overflow-hidden border-x border-zinc-200 bg-white first:rounded-t-xl last:rounded-b-xl dark:border-white/25 dark:bg-zinc-950"
              >
                <button
                  type="button"
                  onClick={() => toggle(b.key)}
                  className="flex w-full flex-wrap items-baseline gap-x-4 gap-y-1 px-3 py-2.5 text-left transition-colors hover:bg-zinc-50 dark:hover:bg-white/5"
                  aria-expanded={isOpen}
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2 font-medium text-zinc-900 dark:text-zinc-100">
                      <span className="text-zinc-400" aria-hidden>
                        {isOpen ? "▾" : "▸"}
                      </span>
                      <span>
                        {b.underlying} {b.kind.replace(/-/g, " ")}
                        {strikes ? ` ${strikes}` : ""}
                      </span>
                    </div>
                    <div className="pl-5 text-xs text-zinc-600 dark:text-zinc-300">
                      {b.accountName}
                      {b.dte != null ? ` · ${b.dte} DTE` : b.expiration ? ` · ${b.expiration}` : ""}
                      {situation
                        ? ` · ${situation.members.length} fills · opened ${situation.openedOn}`
                        : linked
                          ? " · linked"
                          : " · no linked trade history yet"}
                      {isOpen ? " · hide history" : " · show history"}
                    </div>
                  </div>
                  <div className="flex shrink-0 flex-col items-end gap-0.5 pr-1">
                    <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-300">
                      Snapshot
                    </span>
                    {situation?.netPremium != null ? (
                      <span
                        className={
                          "text-xs tabular-nums " +
                          pnlTone(situation.netPremium, { realized: snapshotRealized })
                        }
                      >
                        Net {formatUsd2(situation.netPremium, { mask: privacyMasked })}
                      </span>
                    ) : null}
                  </div>
                </button>

                <ul className="space-y-1 border-t border-zinc-200 px-3 py-2 text-xs dark:border-white/25">
                  {b.legs.map((leg) => (
                    <li key={leg.positionId} className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                      <span className="font-mono text-zinc-700 dark:text-zinc-200">
                        {leg.quantity} {leg.right}
                        {leg.strike != null ? ` ${leg.strike}` : ""}
                      </span>
                      <span className="text-zinc-600 dark:text-zinc-300">
                        {leg.flags.structure === "short-strangle"
                          ? "strangle"
                          : leg.flags.structure.replace(/-/g, " ")}
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
                    <div className="border-t border-zinc-200 px-3 py-3 text-xs text-zinc-600 dark:border-white/25 dark:text-zinc-300">
                      <p>
                        No linked TRADE history for this live book yet. Links rebuild automatically from Schwab fills;
                        use Force re-link if a book still looks stale.
                      </p>
                      {onRefreshLinks ? (
                        <button
                          type="button"
                          onClick={() => onRefreshLinks()}
                          disabled={refreshingLinks}
                          className="mt-2 rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5"
                        >
                          {refreshingLinks ? "Linking…" : "Force re-link"}
                        </button>
                      ) : null}
                    </div>
                  )
                ) : null}
              </article>
            );
          })}
        </div>

        {/* Reserved for future ToS-style risk profile chart */}
        <aside className="hidden min-h-[12rem] flex-1 rounded-xl border border-dashed border-zinc-300 bg-zinc-50/50 p-4 dark:border-white/20 dark:bg-zinc-900/40 lg:block">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-300">Risk profile</div>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
            Reserved for the expiration / T+0 P&amp;L chart. Metrics stay in the left column — this pane will
            hold the selected book&apos;s risk graph.
          </p>
        </aside>
      </div>
    </div>
  );
}
