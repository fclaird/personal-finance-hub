"use client";

import type { CSSProperties } from "react";

import { SymbolLink } from "@/app/components/SymbolLink";
import { perfCellRowStyle } from "@/lib/terminal/dailyPerfColor";

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

export type OptionFlowPayload = {
  ok: boolean;
  source?: string;
  hint?: string;
  detail?: string;
  scanned?: number;
  sessionDate?: string;
  items?: Array<{
    symbol: string;
    totalOptionVolume: number;
    avgOptionVolume20?: number | null;
    relativeVolume?: number | null;
  }>;
};

export type OptionFlowRow = {
  symbol: string;
  totalOptionVolume: number;
  relativeVolume: number | null;
  flagged: boolean;
};

function sentimentRowBackground(changeFraction: number | null): CSSProperties {
  if (changeFraction == null || !Number.isFinite(changeFraction)) {
    return perfCellRowStyle(null);
  }
  return perfCellRowStyle(changeFraction);
}

function volRatioLabel(ratio: number | null) {
  if (ratio == null || !Number.isFinite(ratio)) return "—";
  return `${ratio.toFixed(1)}×`;
}

type Props = {
  optionFlow: OptionFlowPayload | null;
  optionFlowMode: "volume" | "relative";
  onModeChange: (mode: "volume" | "relative") => void;
  optionFlowRows: OptionFlowRow[];
  changePctBySymbol: Map<string, number | null | undefined>;
};

export function OptionFlowPanel({
  optionFlow,
  optionFlowMode,
  onModeChange,
  optionFlowRows,
  changePctBySymbol,
}: Props) {
  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Top option flow</div>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onModeChange("volume")}
            className={
              "h-9 min-w-[3.25rem] whitespace-nowrap rounded-md px-3 text-sm font-semibold " +
              (optionFlowMode === "volume"
                ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
            }
            title="Sort by total option volume"
          >
            Vol
          </button>
          <button
            type="button"
            onClick={() => onModeChange("relative")}
            className={
              "h-9 min-w-[3.25rem] whitespace-nowrap rounded-md px-3 text-sm font-semibold " +
              (optionFlowMode === "relative"
                ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
            }
            title="Sort by option volume vs trailing session average (Opt×)"
          >
            Opt×
          </button>
        </div>
      </div>
      <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
        {optionFlowMode === "volume"
          ? "Total option volume from Schwab chains (subset of your terminal universe)."
          : "Option volume vs trailing ~20 session average (from prior terminal scans)."}
      </div>
      {optionFlow?.source === "unavailable" && (optionFlow.hint || optionFlow.detail) ? (
        <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
          {optionFlow.hint ?? optionFlow.detail}
        </div>
      ) : null}
      <div className="mt-2 grid gap-1">
        {optionFlowRows.map((it) => {
          const chgFrac = changePctBySymbol.get(it.symbol.toUpperCase()) ?? null;
          return (
            <SymbolLink
              key={it.symbol}
              symbol={it.symbol}
              style={sentimentRowBackground(chgFrac)}
              title="Open symbol"
              className="relative flex w-full items-center justify-between overflow-hidden rounded-md border border-zinc-300 px-2 py-1 text-xs hover:no-underline dark:border-white/15"
            >
              <span className="font-semibold">{it.symbol}</span>
              <span className="flex items-center gap-2 tabular-nums">
                <span className="w-[4.5rem] text-right font-semibold">
                  {chgFrac == null ? "—" : `${PCT2.format(chgFrac * 100)}%`}
                </span>
                {optionFlowMode === "relative" ? (
                  <span className={it.flagged ? "font-semibold text-amber-200" : "opacity-90"}>
                    {volRatioLabel(it.relativeVolume)}
                  </span>
                ) : null}
                <span className="opacity-90">{Math.round(it.totalOptionVolume).toLocaleString()} opt vol</span>
              </span>
            </SymbolLink>
          );
        })}
        {optionFlow?.ok && (optionFlow.items?.length ?? 0) === 0 && optionFlow.source === "schwab" ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">No chain volume in the scanned set.</div>
        ) : null}
        {!optionFlow ? <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading…</div> : null}
      </div>
    </div>
  );
}
