"use client";

import { SymbolLink } from "@/app/components/SymbolLink";
import { formatUsd2 } from "@/lib/format";
import { posNegClass } from "@/lib/terminal/colors";
import type { StrategyStats } from "@/lib/strategy/strategyTradeStats";

function pct2(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${n.toFixed(1)}%`;
}

function num2(n: number | null | undefined): string {
  if (n == null || !Number.isFinite(n)) return "—";
  return n.toFixed(2);
}

export function StrategyStatsPanel({
  stats,
  privacyMasked,
}: {
  stats: StrategyStats | null;
  privacyMasked: boolean;
}) {
  if (!stats) return null;

  const wr = stats.winRate;
  const wrClass =
    wr == null ? "" : wr >= 60 ? "text-emerald-600 dark:text-emerald-400" : wr <= 40 ? "text-red-600 dark:text-red-400" : "";

  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Total trades</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{stats.totalTrades}</div>
      </div>
      <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Win rate</div>
        <div className={`mt-1 text-2xl font-semibold tabular-nums ${wrClass}`}>{pct2(wr)}</div>
      </div>
      <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Total P&amp;L</div>
        <div className={"mt-1 text-2xl font-semibold tabular-nums " + (posNegClass(stats.totalPnl) || "text-zinc-900 dark:text-zinc-100")}>
          {stats.totalPnl == null ? "—" : formatUsd2(stats.totalPnl, { mask: privacyMasked })}
        </div>
      </div>
      <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Avg P&amp;L / trade</div>
        <div className={"mt-1 text-2xl font-semibold tabular-nums " + (posNegClass(stats.avgPnlPerTrade) || "text-zinc-900 dark:text-zinc-100")}>
          {stats.avgPnlPerTrade == null ? "—" : formatUsd2(stats.avgPnlPerTrade, { mask: privacyMasked })}
        </div>
      </div>
      <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Avg % return</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{pct2(stats.avgPctReturn)}</div>
      </div>
      <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Largest winner</div>
        <div className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {stats.largestWinner ? (
            <>
              <SymbolLink symbol={stats.largestWinner.symbol}>{stats.largestWinner.symbol}</SymbolLink>{" "}
              <span className="tabular-nums text-emerald-600 dark:text-emerald-400">
                {formatUsd2(stats.largestWinner.pnl, { mask: privacyMasked })}
              </span>
            </>
          ) : (
            "—"
          )}
        </div>
      </div>
      <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Largest loser</div>
        <div className="mt-1 text-sm font-medium text-zinc-800 dark:text-zinc-200">
          {stats.largestLoser ? (
            <>
              <SymbolLink symbol={stats.largestLoser.symbol}>{stats.largestLoser.symbol}</SymbolLink>{" "}
              <span className="tabular-nums text-red-600 dark:text-red-400">
                {formatUsd2(stats.largestLoser.pnl, { mask: privacyMasked })}
              </span>
            </>
          ) : (
            "—"
          )}
        </div>
      </div>
      <div className="rounded-xl border border-zinc-300 bg-white p-4 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="text-xs font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">Sharpe (on % returns)</div>
        <div className="mt-1 text-2xl font-semibold tabular-nums text-zinc-900 dark:text-zinc-100">{num2(stats.sharpeRatio)}</div>
        <div className="mt-1 text-[11px] text-zinc-500 dark:text-zinc-500">Sample-based; interpret cautiously.</div>
      </div>
    </div>
  );
}
