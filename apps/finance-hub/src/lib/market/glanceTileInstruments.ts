import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

/** All instrument ids selectable on quick-glance tiles. */
export const GLANCE_TILE_INSTRUMENT_IDS = [
  "portfolio",
  "nasdaq",
  "sp500",
  "us-es",
  "us-nq",
  "russell2000",
  "gold",
  "bitcoin",
  "ethereum",
  "vix",
  "us-cl",
  "jp-n225",
  "ftse100",
] as const;

export type GlanceTileInstrumentId = (typeof GLANCE_TILE_INSTRUMENT_IDS)[number];

/** Legacy alternate-only ids (Markets slot 4 migration). */
export const GLANCE_ALTERNATE_INSTRUMENT_IDS = [
  "russell2000",
  "gold",
  "bitcoin",
  "ethereum",
  "vix",
  "us-cl",
  "jp-n225",
  "ftse100",
] as const;

export type GlanceAlternateInstrumentId = (typeof GLANCE_ALTERNATE_INSTRUMENT_IDS)[number];

export const DEFAULT_GLANCE_ALTERNATE_INSTRUMENT_ID: GlanceAlternateInstrumentId = "us-cl";

export const DEFAULT_GLANCE_MARKETS_SLOTS: readonly [GlanceTileInstrumentId, GlanceTileInstrumentId, GlanceTileInstrumentId] =
  ["nasdaq", "sp500", "us-cl"];

export const DEFAULT_GLANCE_ALTERNATIVE_SLOTS: readonly [
  GlanceTileInstrumentId,
  GlanceTileInstrumentId,
  GlanceTileInstrumentId,
  GlanceTileInstrumentId,
] = ["jp-n225", "us-es", "us-nq", "russell2000"];

const TILE_INSTRUMENT_LABELS: Record<GlanceTileInstrumentId, string> = {
  portfolio: "Portfolio",
  nasdaq: "Nasdaq",
  sp500: "S&P 500",
  "us-es": "S&P 500 E-mini",
  "us-nq": "Nasdaq 100 E-mini",
  russell2000: "Russell 2000",
  gold: "Gold",
  bitcoin: "Bitcoin",
  ethereum: "Ethereum",
  vix: "VIX",
  "us-cl": "WTI Crude",
  "jp-n225": "Nikkei 225",
  ftse100: "FTSE 100",
};

function optionsFor(ids: readonly GlanceTileInstrumentId[]): ReadonlyArray<{
  id: GlanceTileInstrumentId;
  label: string;
}> {
  return ids.map((id) => ({ id, label: TILE_INSTRUMENT_LABELS[id] }));
}

export const GLANCE_MARKETS_SLOT_2_OPTIONS = optionsFor(["nasdaq", "us-nq"]);
export const GLANCE_MARKETS_SLOT_3_OPTIONS = optionsFor(["sp500", "us-es"]);
export const GLANCE_ALTERNATE_INSTRUMENT_OPTIONS = optionsFor([
  "russell2000",
  "gold",
  "bitcoin",
  "ethereum",
  "vix",
  "us-cl",
  "jp-n225",
  "ftse100",
  "nasdaq",
  "sp500",
  "us-es",
  "us-nq",
]);

export const GLANCE_ALTERNATIVE_SLOT_OPTIONS = GLANCE_ALTERNATE_INSTRUMENT_OPTIONS;

export function isGlanceTileInstrumentId(value: string): value is GlanceTileInstrumentId {
  return (GLANCE_TILE_INSTRUMENT_IDS as readonly string[]).includes(value);
}

export function isGlanceAlternateInstrumentId(value: string): value is GlanceAlternateInstrumentId {
  return (GLANCE_ALTERNATE_INSTRUMENT_IDS as readonly string[]).includes(value);
}

export function pickGlanceTileCard(
  cards: UsMarketGlanceItem[],
  id: GlanceTileInstrumentId,
): UsMarketGlanceItem | null {
  return cards.find((card) => card.id === id) ?? null;
}

/** @deprecated Use pickGlanceTileCard */
export function pickGlanceAlternateCard(
  cards: UsMarketGlanceItem[],
  id: GlanceAlternateInstrumentId,
): UsMarketGlanceItem | null {
  return pickGlanceTileCard(cards, id) ?? cards[0] ?? null;
}

export function buildGlanceCardLookup(cards: UsMarketGlanceItem[]): Map<string, UsMarketGlanceItem> {
  const map = new Map<string, UsMarketGlanceItem>();
  for (const card of cards) {
    if (!map.has(card.id)) map.set(card.id, card);
  }
  return map;
}

export function collectGlanceCards(payload: {
  items?: UsMarketGlanceItem[];
  alternateGlanceItems?: UsMarketGlanceItem[];
  futuresGlanceItems?: UsMarketGlanceItem[];
}): UsMarketGlanceItem[] {
  return [
    ...(payload.items ?? []),
    ...(payload.alternateGlanceItems ?? []),
    ...(payload.futuresGlanceItems ?? []),
  ];
}

export function normalizeGlanceMarketsSlots(
  raw: unknown,
  legacySlot4?: GlanceAlternateInstrumentId,
): [GlanceTileInstrumentId, GlanceTileInstrumentId, GlanceTileInstrumentId] {
  const defaults = [...DEFAULT_GLANCE_MARKETS_SLOTS] as [
    GlanceTileInstrumentId,
    GlanceTileInstrumentId,
    GlanceTileInstrumentId,
  ];
  if (!Array.isArray(raw)) {
    if (legacySlot4) defaults[2] = legacySlot4;
    return defaults;
  }
  const out: [GlanceTileInstrumentId, GlanceTileInstrumentId, GlanceTileInstrumentId] = [...defaults];
  for (let i = 0; i < 3; i++) {
    const v = raw[i];
    if (typeof v === "string" && isGlanceTileInstrumentId(v) && v !== "portfolio") {
      out[i] = v;
    }
  }
  return out;
}

export function normalizeGlanceAlternativeSlots(raw: unknown): [
  GlanceTileInstrumentId,
  GlanceTileInstrumentId,
  GlanceTileInstrumentId,
  GlanceTileInstrumentId,
] {
  const defaults = [...DEFAULT_GLANCE_ALTERNATIVE_SLOTS] as [
    GlanceTileInstrumentId,
    GlanceTileInstrumentId,
    GlanceTileInstrumentId,
    GlanceTileInstrumentId,
  ];
  if (!Array.isArray(raw)) return defaults;
  const out: [
    GlanceTileInstrumentId,
    GlanceTileInstrumentId,
    GlanceTileInstrumentId,
    GlanceTileInstrumentId,
  ] = [...defaults];
  for (let i = 0; i < 4; i++) {
    const v = raw[i];
    if (typeof v === "string" && isGlanceTileInstrumentId(v) && v !== "portfolio") {
      out[i] = v;
    }
  }
  return out;
}
