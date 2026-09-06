"use client";

import { useCallback, useRef, useState } from "react";

import { LiveStructureBooks } from "@/app/components/strategy/LiveStructureBooks";
import { SituationsPanel } from "@/app/components/strategy/SituationsPanel";
import { StrategyStatsPanel } from "@/app/components/strategy/StrategyStatsPanel";
import { StrategyTradesTable } from "@/app/components/strategy/StrategyTradesTable";
import type { SituationView } from "@/lib/situations/apiTypes";
import type { StrategyStats, StrategyTradeApiRow } from "@/lib/strategy/strategyTradeStats";

type BookTab = "open" | "closed" | "fills";

export function StructureBookPanel({
  kind,
  privacyMasked,
  trades,
  stats,
  showStrategyColumn,
}: {
  kind: "short-strangles" | "butterflies";
  privacyMasked: boolean;
  trades: StrategyTradeApiRow[];
  stats: StrategyStats | null;
  showStrategyColumn: boolean;
}) {
  const [tab, setTab] = useState<BookTab>("open");
  const [counts, setCounts] = useState({ open: 0, closed: 0 });
  const [situations, setSituations] = useState<SituationView[]>([]);
  const [refreshingLinks, setRefreshingLinks] = useState(false);
  const proposeRef = useRef<(() => Promise<void>) | null>(null);
  const noun = kind === "short-strangles" ? "strangles" : "butterflies";

  const onCounts = useCallback((next: { open: number; closed: number }) => {
    setCounts(next);
  }, []);
  const onRows = useCallback((rows: SituationView[]) => {
    setSituations(rows);
  }, []);
  const onPropose = useCallback((fn: () => Promise<void>) => {
    proposeRef.current = fn;
  }, []);

  async function refreshLinks() {
    if (!proposeRef.current) return;
    setRefreshingLinks(true);
    try {
      await proposeRef.current();
    } finally {
      setRefreshingLinks(false);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="flex flex-wrap gap-2 text-xs">
          {(
            [
              ["open", `Open ${noun}`, counts.open],
              ["closed", `Closed ${noun}`, counts.closed],
              ["fills", "Fills", trades.length],
            ] as const
          ).map(([id, label, n]) => (
            <button
              key={id}
              type="button"
              onClick={() => setTab(id)}
              className={
                "rounded-full px-3 py-1 font-medium " +
                (tab === id
                  ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                  : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-white/20 dark:text-zinc-200 dark:hover:bg-white/5")
              }
            >
              {label} {n}
            </button>
          ))}
        </div>
        {tab !== "fills" ? (
          <button
            type="button"
            onClick={() => void refreshLinks()}
            disabled={refreshingLinks}
            className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold text-zinc-800 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            {refreshingLinks ? "Linking…" : "Refresh links"}
          </button>
        ) : null}
      </div>
      {tab === "fills" ? (
        <>
          <StrategyStatsPanel stats={stats} privacyMasked={privacyMasked} />
          <StrategyTradesTable rows={trades} privacyMasked={privacyMasked} showStrategyColumn={showStrategyColumn} />
        </>
      ) : (
        <>
          {tab === "open" ? (
            <LiveStructureBooks
              kind={kind}
              situations={situations}
              privacyMasked={privacyMasked}
              onRefreshLinks={() => void refreshLinks()}
              refreshingLinks={refreshingLinks}
            />
          ) : null}
          <SituationsPanel
            privacyMasked={privacyMasked}
            kindFilter={kind}
            hideChrome
            hideList={tab === "open"}
            forcedStatus={tab}
            onCounts={onCounts}
            onRows={onRows}
            onPropose={onPropose}
          />
        </>
      )}
      {tab !== "fills" ? (
        <p className="text-xs text-zinc-600 dark:text-zinc-300">
          {tab === "open"
            ? `Click a live ${noun.slice(0, -1)} to expand trade history (initial open, adjustments/rolls, cumulative premium).`
            : `Closed books expand to the same trade tree. Fills is the raw TRADE list.`}
        </p>
      ) : null}
    </div>
  );
}
