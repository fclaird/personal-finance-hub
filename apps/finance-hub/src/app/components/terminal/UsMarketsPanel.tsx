"use client";

import { useEffect, useState } from "react";

import { MarketGlanceCard, type UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
import { MarketGlanceCombinedChart } from "@/app/components/terminal/MarketGlanceCombinedChart";

export type UsMarketsPayload = {
  updatedAt?: string | null;
  session: {
    headline: string;
    detail: string;
    showingPriorSession?: boolean;
    sessionLabel?: string;
  };
  items: UsMarketGlanceItem[];
};

export type GlanceViewMode = "tiles" | "combined";

const GLANCE_VIEW_STORAGE_KEY = "terminal_glance_view_v1";

function readGlanceViewMode(): GlanceViewMode {
  try {
    const v = localStorage.getItem(GLANCE_VIEW_STORAGE_KEY);
    return v === "combined" ? "combined" : "tiles";
  } catch {
    return "tiles";
  }
}

const VIEW_BTN =
  "rounded-md px-2.5 py-1 text-xs font-semibold tracking-tight transition-colors";

export function UsMarketsPanel({ usMarkets }: { usMarkets: UsMarketsPayload | null }) {
  const [viewMode, setViewMode] = useState<GlanceViewMode>("tiles");

  useEffect(() => {
    setViewMode(readGlanceViewMode());
  }, []);

  useEffect(() => {
    try {
      localStorage.setItem(GLANCE_VIEW_STORAGE_KEY, viewMode);
    } catch {
      /* ignore */
    }
  }, [viewMode]);

  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        {usMarkets ? (
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1">
            <div
              className="flex flex-wrap items-center gap-2 text-[11px] font-medium uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
              title={usMarkets.session.detail}
            >
              <span aria-hidden className="text-amber-500">
                ☀
              </span>
              <span>{usMarkets.session.headline}</span>
            </div>
            {usMarkets.session.showingPriorSession && usMarkets.session.sessionLabel ? (
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                Showing {usMarkets.session.sessionLabel}
              </span>
            ) : null}
          </div>
        ) : (
          <div />
        )}
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-zinc-300 bg-white p-0.5 dark:border-white/20 dark:bg-zinc-950"
            role="group"
            aria-label="Quick glance chart layout"
          >
            <button
              type="button"
              onClick={() => setViewMode("tiles")}
              aria-pressed={viewMode === "tiles"}
              className={
                VIEW_BTN +
                (viewMode === "tiles"
                  ? " bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : " text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900")
              }
            >
              Tiles
            </button>
            <button
              type="button"
              onClick={() => setViewMode("combined")}
              aria-pressed={viewMode === "combined"}
              className={
                VIEW_BTN +
                (viewMode === "combined"
                  ? " bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : " text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900")
              }
            >
              Combined
            </button>
          </div>
          <div className="text-xs text-zinc-600 dark:text-zinc-400">
            {usMarkets?.updatedAt ? `Updated ${new Date(usMarkets.updatedAt).toLocaleTimeString()}` : "—"}
          </div>
        </div>
      </div>

      {usMarkets && usMarkets.items.length > 0 ? (
        <>
          {viewMode === "tiles" ? (
            <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
              {usMarkets.items.map((item) => (
                <MarketGlanceCard key={item.id} item={item} />
              ))}
            </div>
          ) : (
            <MarketGlanceCombinedChart items={usMarkets.items} />
          )}
          <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            {viewMode === "combined"
              ? "Combined view indexes each line to 100 at prior close so portfolio and index day moves are comparable. Portfolio uses live quotes × synced holdings; indices use ETF proxies (SPY, QQQ, IWM)."
              : "Portfolio day % uses live quotes × synced share counts (same price logic as the quote table), includes cash and options, and is indexed to 100 at prior close. Index cards use ETF proxies (SPY, QQQ, IWM). When markets are closed, charts replay the last completed US session."}
          </div>
        </>
      ) : (
        <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Loading today&apos;s glance…</div>
      )}
    </>
  );
}
