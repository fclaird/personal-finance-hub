"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { StrategyStatsPanel } from "@/app/components/strategy/StrategyStatsPanel";
import { EditablePageHeading } from "@/app/components/EditableHeading";
import { RealizedPnlPanel } from "@/app/components/strategy/RealizedPnlPanel";
import { SituationsPanel } from "@/app/components/strategy/SituationsPanel";
import { StrategyTabBar } from "@/app/components/strategy/StrategyTabBar";
import { StructureBookPanel } from "@/app/components/strategy/StructureBookPanel";
import { StrategyTradesTable } from "@/app/components/strategy/StrategyTradesTable";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import type { StrategyTabSlug } from "@/lib/strategy/strategyCategories";
import { STRATEGY_TAB_META } from "@/lib/strategy/strategyCategories";
import { MAX_TRANSACTION_LOOKBACK_DAYS } from "@/lib/schwab/config";
import type { StrategyStats, StrategyTradeApiRow } from "@/lib/strategy/strategyTradeStats";

type ApiOk = {
  ok: true;
  category: string;
  storedTradeRowCount: number;
  tradeDataSource?: "ledger" | "positions_preview";
  trades: StrategyTradeApiRow[];
  stats: StrategyStats;
};

type ApiErr = { ok: false; error?: string };

export function StrategyCategoryPage({ category }: { category: StrategyTabSlug }) {
  const privacy = usePrivacy();
  const [trades, setTrades] = useState<StrategyTradeApiRow[]>([]);
  const [stats, setStats] = useState<StrategyStats | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [reclassifying, setReclassifying] = useState(false);
  const [syncingTx, setSyncingTx] = useState(false);
  const [storedTradeRowCount, setStoredTradeRowCount] = useState<number | null>(null);
  const [tradeDataSource, setTradeDataSource] = useState<"ledger" | "positions_preview">("ledger");

  const skipLedger = category === "situations" || category === "realized";

  const load = useCallback(async () => {
    if (skipLedger) {
      setError(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const qs = new URLSearchParams({ category });
      const resp = await fetch(`/api/strategy-trades?${qs.toString()}`, { cache: "no-store" });
      const json = (await resp.json()) as ApiOk | ApiErr;
      if (!json.ok) throw new Error("error" in json ? json.error : "Failed to load");
      setTrades(json.trades);
      setStats(json.stats);
      setStoredTradeRowCount(json.storedTradeRowCount);
      setTradeDataSource(json.tradeDataSource ?? "ledger");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setTrades([]);
      setStats(null);
      setStoredTradeRowCount(null);
      setTradeDataSource("ledger");
    } finally {
      setLoading(false);
    }
  }, [category, skipLedger]);

  useEffect(() => {
    void load();
  }, [load]);

  async function syncTransactionsNow() {
    setSyncingTx(true);
    setError(null);
    try {
      const resp = await fetch("/api/schwab/transactions/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookbackDays: MAX_TRANSACTION_LOOKBACK_DAYS }),
      });
      const json = (await resp.json()) as { ok?: boolean; error?: string; transactionsUpserted?: number };
      if (!json.ok) throw new Error(json.error ?? "Transaction sync failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSyncingTx(false);
    }
  }

  async function reclassify() {
    setReclassifying(true);
    setError(null);
    try {
      const resp = await fetch("/api/strategy-trades/reclassify", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({}),
      });
      const json = (await resp.json()) as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Reclassify failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setReclassifying(false);
    }
  }

  const meta = STRATEGY_TAB_META.find((t) => t.slug === category);

  const csvHref = `/api/strategy-trades?category=${encodeURIComponent(category)}&format=csv`;

  const isStructure = category === "short-strangles" || category === "butterflies";

  return (
    <div className="flex flex-col gap-5">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            <EditablePageHeading pageId="option-strategies" defaultTitle="Option Strategies" />
          </h1>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Short-premium book first (situations, strangles, butterflies). Analytics only — no orders.
          </p>
        </div>
        <Link
          href="/connections"
          className="shrink-0 rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-medium text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
        >
          Connections
        </Link>
      </div>

      <StrategyTabBar category={category} />

      {category === "situations" ? <SituationsPanel privacyMasked={privacy.masked} /> : null}
      {category === "realized" ? <RealizedPnlPanel privacyMasked={privacy.masked} /> : null}

      {skipLedger ? null : (
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          {isStructure ? null : (
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{meta?.label ?? category}</h2>
          )}
          <p className={"text-sm text-zinc-600 dark:text-zinc-400 " + (isStructure ? "" : "mt-1")}>
            {isStructure
              ? "Live snapshot books, then linked situations (open → adjust → close). Fills is the raw TRADE list."
              : "Schwab TRADE fills for this bucket. P&L is broker net amount."}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <a
            href={csvHref}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Export CSV
          </a>
          <button
            type="button"
            onClick={() => void reclassify()}
            disabled={reclassifying}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            {reclassifying ? "Reclassifying…" : "Re-run classification"}
          </button>
        </div>
      </div>
      )}

      {error && !skipLedger ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}

      {!skipLedger && !loading && tradeDataSource === "positions_preview" ? (
        <div className="rounded-xl border border-sky-200 bg-sky-50 p-4 text-sm text-sky-950 dark:border-sky-900/50 dark:bg-sky-950/30 dark:text-sky-100">
          <p className="font-medium">Preview: open option positions</p>
          <p className="mt-2 text-sky-900/90 dark:text-sky-100/85">
            Your Schwab <strong>TRADE</strong> ledger is still empty locally. These rows come from the latest position
            sync (holdings), not individual trades. Use <strong>Sync transaction history</strong> (here or on Connections)
            for a full activity list, P&amp;L, and strategy buckets.
          </p>
        </div>
      ) : null}

      {!skipLedger && !loading && trades.length === 0 && storedTradeRowCount === 0 ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950 dark:border-amber-900/40 dark:bg-amber-950/25 dark:text-amber-100">
          <p className="font-medium">No trade history in your local database yet</p>
          <p className="mt-2 text-amber-900/90 dark:text-amber-100/85">
            Option Strategies lists Schwab <strong>TRADE</strong> activity stored in this app. Position sync does not fill
            this list — run a transaction history sync (same action as on Connections) so rows appear in every tab.
          </p>
          <div className="mt-3 flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => void syncTransactionsNow()}
              disabled={syncingTx}
              className="rounded-full bg-amber-900 px-4 py-2 text-xs font-semibold text-amber-50 hover:bg-amber-800 disabled:opacity-50 dark:bg-amber-200 dark:text-amber-950 dark:hover:bg-amber-100"
            >
              {syncingTx ? "Syncing transactions…" : "Sync transaction history now"}
            </button>
            <Link
              href="/connections"
              className="rounded-full border border-amber-800/30 px-4 py-2 text-xs font-semibold text-amber-950 hover:bg-amber-100/80 dark:border-amber-100/30 dark:text-amber-50 dark:hover:bg-white/10"
            >
              Open Connections
            </Link>
          </div>
        </div>
      ) : null}

      {!skipLedger && !isStructure && !loading && trades.length === 0 && storedTradeRowCount !== null && storedTradeRowCount > 0 ? (
        <div className="rounded-xl border border-zinc-200 bg-zinc-50 p-4 text-sm text-zinc-800 dark:border-white/15 dark:bg-white/5 dark:text-zinc-200">
          No trades match this classification tab. Try the <strong>All</strong> tab to see every stored row.
        </div>
      ) : null}

      {skipLedger ? null : isStructure ? (
        <StructureBookPanel
          kind={category}
          privacyMasked={privacy.masked}
          trades={trades}
          stats={stats}
          showStrategyColumn={tradeDataSource === "positions_preview"}
        />
      ) : (
        <>
          <StrategyStatsPanel stats={stats} privacyMasked={privacy.masked} />
          <StrategyTradesTable
            rows={trades}
            privacyMasked={privacy.masked}
            showStrategyColumn={category === "all" || tradeDataSource === "positions_preview"}
          />
        </>
      )}
    </div>
  );
}
