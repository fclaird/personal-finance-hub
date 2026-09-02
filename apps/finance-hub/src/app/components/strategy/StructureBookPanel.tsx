"use client";

import { useState } from "react";

import { SituationsPanel } from "@/app/components/strategy/SituationsPanel";
import { StrategyStatsPanel } from "@/app/components/strategy/StrategyStatsPanel";
import { StrategyTradesTable } from "@/app/components/strategy/StrategyTradesTable";
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
  const noun = kind === "short-strangles" ? "strangles" : "butterflies";

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap gap-2 text-xs">
        {(
          [
            ["open", `Open ${noun}`],
            ["closed", `Closed ${noun}`],
            ["fills", "Fills"],
          ] as const
        ).map(([id, label]) => (
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
            {label}
          </button>
        ))}
      </div>
      {tab === "fills" ? (
        <>
          <StrategyStatsPanel stats={stats} privacyMasked={privacyMasked} />
          <StrategyTradesTable rows={trades} privacyMasked={privacyMasked} showStrategyColumn={showStrategyColumn} />
        </>
      ) : (
        <SituationsPanel
          privacyMasked={privacyMasked}
          kindFilter={kind}
          hideChrome
          forcedStatus={tab}
        />
      )}
      {tab !== "fills" ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Open/closed use linked situations. Use the Open/Closed pills on the book, then Fills for raw TRADE rows.
        </p>
      ) : null}
    </div>
  );
}
