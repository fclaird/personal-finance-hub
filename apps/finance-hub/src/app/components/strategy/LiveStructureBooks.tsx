"use client";

import { useEffect, useMemo, useState } from "react";

import { SituationHeadingTotals, SituationLifecycle } from "@/app/components/strategy/SituationLifecycle";
import { ShortStrangleRiskChart } from "@/app/components/strategy/ShortStrangleRiskChart";
import { clumpPartialFills } from "@/lib/situations/clumpPartialFills";
import { situationHeadingFigures } from "@/lib/situations/situationTree";
import type { OptionRiskSummary } from "@/lib/alerts/optionRisk";
import { formatUsd2 } from "@/lib/format";
import {
  groupLiveBooksForTab,
  liveBookLinkedToOpenSituation,
  type EarningsNearRow,
  type LiveStructureBook,
} from "@/lib/situations/liveStructures";
import type { SituationView } from "@/lib/situations/apiTypes";
import type { StrategyTabSlug } from "@/lib/strategy/strategyCategories";

function matchSituation(book: LiveStructureBook, situations: SituationView[]): SituationView | null {
  if (book.kind !== "short-strangle" && book.kind !== "butterfly") return null;
  const open = situations.filter(
    (s) =>
      s.linkStatus !== "rejected" &&
      s.status === "open" &&
      s.accountId === book.accountId &&
      s.underlying.toUpperCase() === book.underlying.toUpperCase() &&
      ((book.kind === "short-strangle" && s.kind === "short-strangle") ||
        (book.kind === "butterfly" && s.kind === "butterfly")),
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

function liveBooksNoun(tab: StrategyTabSlug): string {
  switch (tab) {
    case "short-strangles":
      return "strangles";
    case "butterflies":
      return "butterflies";
    case "spreads":
      return "spreads";
    case "options-sales":
      return "short puts";
    case "naked-calls":
      return "naked calls";
    case "covered-calls":
      return "covered calls";
    case "earnings":
      return "earnings books";
    case "leaps":
      return "LEAPs";
    case "long-calls":
      return "long calls";
    case "long-puts":
      return "long puts";
    case "all":
      return "option books";
    default:
      return "books";
  }
}

function isoShift(days: number): string {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function LiveStructureBooks({
  kind,
  situations,
  privacyMasked,
  onRefreshLinks,
  refreshingLinks = false,
}: {
  kind: StrategyTabSlug;
  situations: SituationView[];
  privacyMasked: boolean;
  onRefreshLinks?: () => void;
  refreshingLinks?: boolean;
}) {
  const noun = liveBooksNoun(kind);
  const hasTradeHistory = kind === "short-strangles" || kind === "butterflies";
  const [summary, setSummary] = useState<OptionRiskSummary | null>(null);
  const [earningsNear, setEarningsNear] = useState<EarningsNearRow[]>([]);
  const [spotByUnd, setSpotByUnd] = useState<Map<string, number>>(() => new Map());
  const [expanded, setExpanded] = useState<Set<string>>(() => new Set());
  /** Chart follows expanded card when set; otherwise last-clicked / first book. */
  const [selectedKey, setSelectedKey] = useState<string | null>(null);

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

  useEffect(() => {
    if (kind !== "earnings") {
      setEarningsNear([]);
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch(`/api/earnings?from=${isoShift(-7)}&to=${isoShift(45)}`, { cache: "no-store" });
        const json = (await resp.json()) as { ok?: boolean; rows?: EarningsNearRow[] };
        if (!cancelled && json.ok) setEarningsNear(json.rows ?? []);
      } catch {
        /* earnings calendar optional */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [kind]);

  const books = useMemo(
    () => groupLiveBooksForTab(summary?.positions ?? [], kind, { earningsNear }),
    [summary, kind, earningsNear],
  );

  const underlyingsKey = useMemo(
    () =>
      [...new Set(books.map((b) => b.underlying.trim().toUpperCase()).filter(Boolean))]
        .sort()
        .join(","),
    [books],
  );

  useEffect(() => {
    if (!underlyingsKey) {
      setSpotByUnd(new Map());
      return;
    }
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch(
          `/api/option-strategies/risk-chart-spot?symbols=${encodeURIComponent(underlyingsKey)}`,
          { cache: "no-store" },
        );
        const json = (await resp.json()) as { ok?: boolean; spots?: Record<string, number | null> };
        if (cancelled || !json.ok || !json.spots) return;
        const next = new Map<string, number>();
        for (const [sym, px] of Object.entries(json.spots)) {
          if (px != null && Number.isFinite(px) && px > 0) next.set(sym.toUpperCase(), px);
        }
        setSpotByUnd(next);
      } catch {
        /* keep OHLCV fallback on the graphic */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [underlyingsKey]);

  function selectBook(key: string) {
    setSelectedKey(key);
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  const selectedBook = useMemo(() => {
    if (books.length === 0) return null;
    const expandedBooks = books.filter((b) => expanded.has(b.key));
    if (expandedBooks.length > 0) {
      return expandedBooks.find((b) => b.key === selectedKey) ?? expandedBooks[expandedBooks.length - 1]!;
    }
    if (selectedKey) return books.find((b) => b.key === selectedKey) ?? books[0]!;
    return books[0]!;
  }, [books, expanded, selectedKey]);

  if (!summary || books.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline gap-x-4 gap-y-1">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Live {noun}</h3>
        <p className="text-xs text-zinc-600 dark:text-zinc-300">
          {hasTradeHistory
            ? "Click a card for trade history (open → adjustments → current). Snapshot legs above the fold."
            : "Click a card to show its expiration / T+0 P&L chart. Snapshot legs above the fold."}
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
            const heading = situation
              ? situationHeadingFigures(clumpPartialFills(situation.members), { status: situation.status })
              : { openCredit: null, realized: null };

            return (
              <article
                key={b.key}
                className={
                  "overflow-hidden border-x border-zinc-200 bg-white first:rounded-t-xl last:rounded-b-xl dark:border-white/25 dark:bg-zinc-950" +
                  (selectedBook?.key === b.key ? " ring-1 ring-inset ring-cyan-500/40" : "")
                }
              >
                <button
                  type="button"
                  onClick={() => selectBook(b.key)}
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
                      {spotByUnd.get(b.underlying.toUpperCase()) != null
                        ? ` · spot ${spotByUnd.get(b.underlying.toUpperCase())!.toFixed(2)}`
                        : ""}
                      {hasTradeHistory
                        ? situation
                          ? ` · ${situation.members.length} fills · opened ${situation.openedOn}`
                          : linked
                            ? " · linked"
                            : " · no linked trade history yet"
                        : ""}
                      {hasTradeHistory ? (isOpen ? " · hide history" : " · show history") : ""}
                    </div>
                  </div>
                  <SituationHeadingTotals
                    openCredit={heading.openCredit}
                    realized={heading.realized}
                    privacyMasked={privacyMasked}
                  />
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

                {isOpen && hasTradeHistory ? (
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

        <ShortStrangleRiskChart
          book={selectedBook}
          privacyMasked={privacyMasked}
          liveSpot={
            selectedBook
              ? (spotByUnd.get(selectedBook.underlying.toUpperCase()) ?? null)
              : null
          }
        />
      </div>
    </div>
  );
}
