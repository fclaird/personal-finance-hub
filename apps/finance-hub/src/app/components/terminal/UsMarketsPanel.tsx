"use client";

import { MarketGlanceCard, type UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

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

export function UsMarketsPanel({ usMarkets }: { usMarkets: UsMarketsPayload | null }) {
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
        <div className="text-xs text-zinc-600 dark:text-zinc-400">
          {usMarkets?.updatedAt ? `Updated ${new Date(usMarkets.updatedAt).toLocaleTimeString()}` : "—"}
        </div>
      </div>

      {usMarkets && usMarkets.items.length > 0 ? (
        <>
          <div className="mt-3 flex gap-3 overflow-x-auto pb-1">
            {usMarkets.items.map((item) => (
              <MarketGlanceCard key={item.id} item={item} />
            ))}
          </div>
          <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            Portfolio day % uses live quotes × synced share counts (same price logic as the quote table), includes
            cash and options, and is indexed to 100 at prior close. Index cards use ETF proxies (SPY, QQQ, IWM).
            When markets are closed, charts replay the last completed US session.
          </div>
        </>
      ) : (
        <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Loading today&apos;s glance…</div>
      )}
    </>
  );
}
