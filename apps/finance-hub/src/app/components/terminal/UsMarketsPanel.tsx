"use client";

import { useEffect, useMemo, useState } from "react";

import {
  MarketGlanceCard,
  sharedSparklineYDomain,
  type UsMarketGlanceItem,
} from "@/app/components/terminal/MarketGlanceCard";
import { MarketGlanceCombinedChart } from "@/app/components/terminal/MarketGlanceCombinedChart";
import {
  GLANCE_ALTERNATE_INSTRUMENT_OPTIONS,
  pickGlanceAlternateCard,
  type GlanceAlternateInstrumentId,
} from "@/lib/market/glanceAlternateInstrumentIds";
import type { GlanceTileChartWindowCtx } from "@/lib/market/glanceTileChartWindow";
import {
  readGlanceAlternateInstrument,
  readGlanceSourceMode,
  readGlanceViewMode,
  writeGlanceAlternateInstrument,
  writeGlanceSourceMode,
  writeGlanceViewMode,
  type GlanceSourceMode,
  type GlanceViewMode,
} from "@/app/components/terminal/terminalDisplayPrefs";

export type UsMarketsPayload = {
  updatedAt?: string | null;
  session: {
    headline: string;
    detail: string;
    isOpen: boolean;
    showingPriorSession?: boolean;
    sessionLabel?: string;
    sessionYmd?: string;
  };
  items: UsMarketGlanceItem[];
  alternateGlanceItems?: UsMarketGlanceItem[];
  futuresGlanceItems?: UsMarketGlanceItem[];
};

export type { GlanceViewMode };

const VIEW_BTN =
  "rounded-md px-2.5 py-1 text-xs font-semibold tracking-tight transition-colors";

function resolveGlanceMarketOpen(
  item: UsMarketGlanceItem,
  sessionIsOpen: boolean,
): boolean {
  if (item.tradableOpen != null) return item.tradableOpen;
  if (item.futuresKind != null || item.instrumentKind === "cash_index") return false;
  return sessionIsOpen;
}

export function UsMarketsPanel({ usMarkets }: { usMarkets: UsMarketsPayload | null }) {
  const [viewMode, setViewMode] = useState<GlanceViewMode>("tiles");
  const [sourceMode, setSourceMode] = useState<GlanceSourceMode>("markets");
  const [alternateInstrumentId, setAlternateInstrumentId] = useState<GlanceAlternateInstrumentId>(
    readGlanceAlternateInstrument(),
  );
  const [prefsHydrated, setPrefsHydrated] = useState(false);

  useEffect(() => {
    setViewMode(readGlanceViewMode());
    setSourceMode(readGlanceSourceMode());
    setAlternateInstrumentId(readGlanceAlternateInstrument());
    setPrefsHydrated(true);
  }, []);

  useEffect(() => {
    if (!prefsHydrated) return;
    writeGlanceViewMode(viewMode);
  }, [viewMode, prefsHydrated]);

  useEffect(() => {
    if (!prefsHydrated) return;
    writeGlanceSourceMode(sourceMode);
  }, [sourceMode, prefsHydrated]);

  useEffect(() => {
    if (!prefsHydrated) return;
    writeGlanceAlternateInstrument(alternateInstrumentId);
  }, [alternateInstrumentId, prefsHydrated]);

  const alternateItem = useMemo(
    () => pickGlanceAlternateCard(usMarkets?.alternateGlanceItems ?? [], alternateInstrumentId),
    [usMarkets?.alternateGlanceItems, alternateInstrumentId],
  );

  const displayItems = useMemo(() => {
    if (sourceMode === "futures") return usMarkets?.futuresGlanceItems ?? [];
    const base = usMarkets?.items ?? [];
    return alternateItem ? [...base, alternateItem] : base;
  }, [alternateItem, sourceMode, usMarkets?.futuresGlanceItems, usMarkets?.items]);

  const tileChartWindowCtx = useMemo(
    (): GlanceTileChartWindowCtx => ({
      marketOpen: usMarkets?.session.isOpen ?? false,
      sessionYmd: usMarkets?.session.sessionYmd,
    }),
    [usMarkets?.session.isOpen, usMarkets?.session.sessionYmd],
  );

  const tileChartYDomain = useMemo(
    () =>
      displayItems.length > 0 ? sharedSparklineYDomain(displayItems, tileChartWindowCtx) : undefined,
    [displayItems, tileChartWindowCtx],
  );

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
            {sourceMode === "markets" && usMarkets.session.showingPriorSession && usMarkets.session.sessionLabel ? (
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                Showing {usMarkets.session.sessionLabel}
              </span>
            ) : null}
            {sourceMode === "futures" ? (
              <span className="text-[11px] font-medium text-zinc-600 dark:text-zinc-300">
                Nikkei · ES · NQ · Russell (Yahoo + Stooq)
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
            aria-label="Quick glance data source"
          >
            <button
              type="button"
              onClick={() => setSourceMode("markets")}
              aria-pressed={sourceMode === "markets"}
              className={
                VIEW_BTN +
                (sourceMode === "markets"
                  ? " bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : " text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900")
              }
            >
              Markets
            </button>
            <button
              type="button"
              onClick={() => setSourceMode("futures")}
              aria-pressed={sourceMode === "futures"}
              className={
                VIEW_BTN +
                (sourceMode === "futures"
                  ? " bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                  : " text-zinc-700 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-900")
              }
            >
              Futures
            </button>
          </div>
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

      {usMarkets && displayItems.length > 0 ? (
        <>
          {viewMode === "tiles" ? (
            <div className="mt-3 grid min-w-0 grid-cols-4 gap-3 overflow-x-auto pb-1">
              {displayItems.map((item) => (
                <MarketGlanceCard
                  key={item.id}
                  item={item}
                  chartYDomain={tileChartYDomain}
                  className="min-w-0"
                  marketOpen={resolveGlanceMarketOpen(item, usMarkets.session.isOpen)}
                  sessionLabel={usMarkets.session.sessionLabel}
                  sessionYmd={usMarkets.session.sessionYmd}
                  updatedAt={usMarkets.updatedAt}
                  alternateTitleSelector={
                    sourceMode === "markets" && item.id === alternateItem?.id
                      ? {
                          options: GLANCE_ALTERNATE_INSTRUMENT_OPTIONS,
                          value: alternateInstrumentId,
                          onChange: setAlternateInstrumentId,
                        }
                      : undefined
                  }
                />
              ))}
            </div>
          ) : (
            <MarketGlanceCombinedChart items={displayItems} windowCtx={tileChartWindowCtx} />
          )}
          <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            {viewMode === "combined"
              ? sourceMode === "futures"
                ? "Futures mode: green = Globex/cash session while that market trades (~23h ES/NQ Sun 6pm–Fri 5pm ET). Gray only for daily 5–6pm ET halt or weekend. Not US stock RTH hours."
                : "Combined view indexes each line to 100 at prior close so portfolio and index day moves are comparable. Extended pre/after-hours segments are included when available."
              : sourceMode === "futures"
                ? "ES/NQ are CME Globex futures. Nikkei 225 is the Tokyo cash index (not a future). Russell 2000 tracks IWM with US equity session hours. Amber header = that market is closed."
                : "Portfolio tile uses Schwab liquidation/account values for linked accounts, plus 529 and other external holdings. The 4th tile title opens a menu (Russell 2000, Gold, Bitcoin, WTI Crude, Nikkei 225, FTSE 100). Default is WTI Crude (CL futures, Globex hours). Tile charts zoom to the last RTH hour after the close (from 15:00 ET) or pre-market plus session after the open (from 08:30 ET). When a market is closed the dashed line sits at session close and extended hours are shaded gray."}
          </div>
        </>
      ) : (
        <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          {sourceMode === "futures" ? "Loading global futures glance…" : "Loading today&apos;s glance…"}
        </div>
      )}
    </>
  );
}
