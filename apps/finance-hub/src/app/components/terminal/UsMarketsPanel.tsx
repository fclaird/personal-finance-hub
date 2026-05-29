"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  MarketGlanceCard,
  type UsMarketGlanceItem,
} from "@/app/components/terminal/MarketGlanceCard";
import { MarketGlanceCombinedChart } from "@/app/components/terminal/MarketGlanceCombinedChart";
import { resolveMarketsSlotInstrumentId } from "@/lib/market/glanceMarketsTileResolve";
import {
  buildGlanceCardLookup,
  collectGlanceCards,
  GLANCE_ALTERNATE_INSTRUMENT_OPTIONS,
  GLANCE_ALTERNATIVE_SLOT_OPTIONS,
  GLANCE_MARKETS_SLOT_2_OPTIONS,
  GLANCE_MARKETS_SLOT_3_OPTIONS,
  type GlanceTileInstrumentId,
} from "@/lib/market/glanceTileInstruments";
import type { GlanceTileChartWindowCtx } from "@/lib/market/glanceTileChartWindow";
import {
  readGlanceAlternativeSlots,
  readGlanceMarketsSlots,
  readGlanceSourceMode,
  readGlanceViewMode,
  writeGlanceAlternativeSlots,
  writeGlanceMarketsSlots,
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
    chartYmd?: string;
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

function resolveTileCard(
  lookup: Map<string, UsMarketGlanceItem>,
  id: GlanceTileInstrumentId,
): UsMarketGlanceItem | null {
  return lookup.get(id) ?? null;
}

export function UsMarketsPanel({ usMarkets }: { usMarkets: UsMarketsPayload | null }) {
  const [viewMode, setViewMode] = useState<GlanceViewMode>("tiles");
  const [sourceMode, setSourceMode] = useState<GlanceSourceMode>("markets");
  const [marketsSlots, setMarketsSlots] = useState(readGlanceMarketsSlots);
  const [alternativeSlots, setAlternativeSlots] = useState(readGlanceAlternativeSlots);
  const [prefsHydrated, setPrefsHydrated] = useState(false);

  useEffect(() => {
    setViewMode(readGlanceViewMode());
    setSourceMode(readGlanceSourceMode());
    setMarketsSlots(readGlanceMarketsSlots());
    setAlternativeSlots(readGlanceAlternativeSlots());
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
    writeGlanceMarketsSlots(marketsSlots);
  }, [marketsSlots, prefsHydrated]);

  useEffect(() => {
    if (!prefsHydrated) return;
    writeGlanceAlternativeSlots(alternativeSlots);
  }, [alternativeSlots, prefsHydrated]);

  const cardLookup = useMemo(() => {
    if (!usMarkets) return new Map<string, UsMarketGlanceItem>();
    return buildGlanceCardLookup(collectGlanceCards(usMarkets));
  }, [usMarkets]);

  const marketsTileSpecs = useMemo(() => {
    const now = new Date();
    const portfolio = usMarkets?.items[0];
    if (!portfolio) return [];
    const slot2Id = resolveMarketsSlotInstrumentId(2, marketsSlots[0], now);
    const slot3Id = resolveMarketsSlotInstrumentId(3, marketsSlots[1], now);
    const slot4Id = marketsSlots[2];
    return [
      { storedId: "portfolio" as const, resolvedId: "portfolio" as const, card: portfolio, adjustable: false },
      {
        storedId: marketsSlots[0],
        resolvedId: slot2Id,
        card: resolveTileCard(cardLookup, slot2Id),
        adjustable: true,
        slotIndex: 2 as const,
      },
      {
        storedId: marketsSlots[1],
        resolvedId: slot3Id,
        card: resolveTileCard(cardLookup, slot3Id),
        adjustable: true,
        slotIndex: 3 as const,
      },
      {
        storedId: slot4Id,
        resolvedId: slot4Id,
        card: resolveTileCard(cardLookup, slot4Id),
        adjustable: true,
        slotIndex: 4 as const,
      },
    ];
  }, [cardLookup, marketsSlots, usMarkets?.items]);

  const alternativeTileSpecs = useMemo(
    () =>
      alternativeSlots.map((storedId, index) => ({
        storedId,
        resolvedId: storedId,
        card: resolveTileCard(cardLookup, storedId),
        adjustable: true,
        slotIndex: (index + 1) as 1 | 2 | 3 | 4,
      })),
    [alternativeSlots, cardLookup],
  );

  const tileSpecs = sourceMode === "futures" ? alternativeTileSpecs : marketsTileSpecs;
  const displayItems = useMemo(
    () => tileSpecs.map((s) => s.card).filter((c): c is UsMarketGlanceItem => c != null),
    [tileSpecs],
  );

  const tileChartWindowCtx = useMemo(
    (): GlanceTileChartWindowCtx => ({
      marketOpen: usMarkets?.session.isOpen ?? false,
      sessionYmd: usMarkets?.session.sessionYmd,
      chartYmd: usMarkets?.session.chartYmd,
      showingPriorSession: usMarkets?.session.showingPriorSession,
      nowMs: Date.now(),
    }),
    [
      usMarkets?.session.isOpen,
      usMarkets?.session.sessionYmd,
      usMarkets?.session.chartYmd,
      usMarkets?.session.showingPriorSession,
    ],
  );

  const setMarketsSlot = useCallback((slotIndex: 2 | 3 | 4, id: GlanceTileInstrumentId) => {
    setMarketsSlots((prev) => {
      const next: [GlanceTileInstrumentId, GlanceTileInstrumentId, GlanceTileInstrumentId] = [...prev];
      next[slotIndex - 2] = id;
      return next;
    });
  }, []);

  const setAlternativeSlot = useCallback((slotIndex: 1 | 2 | 3 | 4, id: GlanceTileInstrumentId) => {
    setAlternativeSlots((prev) => {
      const next: [
        GlanceTileInstrumentId,
        GlanceTileInstrumentId,
        GlanceTileInstrumentId,
        GlanceTileInstrumentId,
      ] = [...prev];
      next[slotIndex - 1] = id;
      return next;
    });
  }, []);

  const titleSelectorForSpec = useCallback(
    (spec: (typeof tileSpecs)[number]) => {
      if (!spec.adjustable || !("slotIndex" in spec)) return undefined;
      if (sourceMode === "futures") {
        const slotIndex = spec.slotIndex as 1 | 2 | 3 | 4;
        return {
          options: GLANCE_ALTERNATIVE_SLOT_OPTIONS,
          value: spec.storedId,
          onChange: (id: GlanceTileInstrumentId) => setAlternativeSlot(slotIndex, id),
        };
      }
      const slotIndex = spec.slotIndex as 2 | 3 | 4;
      const options =
        slotIndex === 2
          ? GLANCE_MARKETS_SLOT_2_OPTIONS
          : slotIndex === 3
            ? GLANCE_MARKETS_SLOT_3_OPTIONS
            : GLANCE_ALTERNATE_INSTRUMENT_OPTIONS;
      return {
        options,
        value: spec.storedId,
        onChange: (id: GlanceTileInstrumentId) => setMarketsSlot(slotIndex, id),
      };
    },
    [setAlternativeSlot, setMarketsSlot, sourceMode],
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
                Each tile is selectable (Nikkei, ES/NQ, Russell, Gold, crypto, VIX, WTI, FTSE, QQQ/SPY)
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
              Alternative
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
              {tileSpecs.map((spec, index) => {
                const item = spec.card;
                if (!item) return null;
                return (
                  <MarketGlanceCard
                    key={`${sourceMode}-slot-${index}`}
                    item={item}
                    className="min-w-0"
                    marketOpen={resolveGlanceMarketOpen(item, usMarkets.session.isOpen)}
                    sessionLabel={usMarkets.session.sessionLabel}
                    sessionYmd={usMarkets.session.sessionYmd}
                    chartYmd={usMarkets.session.chartYmd}
                    showingPriorSession={usMarkets.session.showingPriorSession}
                    updatedAt={usMarkets.updatedAt}
                    alternateTitleSelector={titleSelectorForSpec(spec)}
                  />
                );
              })}
            </div>
          ) : (
            <MarketGlanceCombinedChart
              items={displayItems}
              windowCtx={tileChartWindowCtx}
            />
          )}
          <div className="mt-2 text-xs text-zinc-600 dark:text-zinc-400">
            {viewMode === "combined"
              ? sourceMode === "futures"
                ? "Alternative mode: green = Globex/cash session while that market trades (~23h ES/NQ Sun 6pm–Fri 5pm ET). Gray only for daily 5–6pm ET halt or weekend. Not US stock RTH hours."
                : "Combined view indexes each line to 100 at prior close so portfolio and index day moves are comparable. Extended pre/after-hours segments are included when available (8pm–4am ET excluded)."
              : sourceMode === "futures"
                ? "Each tile title opens a menu. ES/NQ are CME Globex futures; Nikkei 225 is the Tokyo cash index. Amber header = that market is closed."
                : "Portfolio uses Schwab liquidation values plus external holdings. Nasdaq and S&P tiles auto-switch to NQ/ES e-mini outside US RTH unless you pick a specific instrument. Slots 2–4 have title menus. Tile charts zoom to the last RTH hour after the close or the live session after the open. 8pm–4am ET is omitted from extended segments."}
          </div>
        </>
      ) : (
        <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
          {sourceMode === "futures" ? "Loading alternative glance…" : "Loading today&apos;s glance…"}
        </div>
      )}
    </>
  );
}
