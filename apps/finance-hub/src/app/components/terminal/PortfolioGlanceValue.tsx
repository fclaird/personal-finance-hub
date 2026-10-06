"use client";

import { formatUsd2 } from "@/lib/format";
import { usePortfolioGlanceUnlocked } from "@/app/components/terminal/portfolioGlanceUnlocked";

function formatDayPct(pct: number | null | undefined): string {
  if (pct == null || !Number.isFinite(pct)) return "—";
  return `${pct >= 0 ? "+" : ""}${pct.toFixed(2)}%`;
}

export function PortfolioGlanceValue({
  netValue,
  changePct,
  changeLabel = "Day",
  baselineNote,
  indexLevel,
}: {
  netValue: number | null | undefined;
  changePct?: number | null;
  changeLabel?: string;
  baselineNote?: string | null;
  indexLevel?: number | null;
}) {
  const { unlocked, startEditing, lock } = usePortfolioGlanceUnlocked();
  const pctLine = (
    <div
      className="text-[10px] font-medium tabular-nums text-zinc-500 dark:text-zinc-400"
      title={baselineNote ?? undefined}
    >
      {formatDayPct(changePct)} {changeLabel}
    </div>
  );

  if (indexLevel != null && Number.isFinite(indexLevel)) {
    return (
      <div className="text-right">
        <div className="truncate text-sm font-semibold leading-5 tabular-nums text-zinc-900 dark:text-zinc-50">
          {indexLevel.toFixed(2)}
        </div>
        {pctLine}
      </div>
    );
  }

  if (unlocked) {
    return (
      <div className="text-right">
        <button
          type="button"
          onClick={lock}
          className="truncate text-sm font-semibold leading-5 tabular-nums text-zinc-900 hover:opacity-80 dark:text-zinc-50"
          title="Click to hide balance"
        >
          {formatUsd2(netValue)}
        </button>
        {pctLine}
      </div>
    );
  }

  return (
    <div className="text-right">
      <button
        type="button"
        onClick={startEditing}
        className="truncate text-right text-sm font-medium leading-5 text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
        title="Show portfolio balance (uses privacy mask)"
      >
        Show balance
      </button>
      {pctLine}
    </div>
  );
}
