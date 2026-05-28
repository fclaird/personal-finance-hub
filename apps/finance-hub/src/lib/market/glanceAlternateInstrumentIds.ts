export const GLANCE_ALTERNATE_INSTRUMENT_IDS = [
  "russell2000",
  "gold",
  "bitcoin",
  "us-cl",
  "jp-n225",
  "ftse100",
] as const;

export type GlanceAlternateInstrumentId = (typeof GLANCE_ALTERNATE_INSTRUMENT_IDS)[number];

export const GLANCE_ALTERNATE_INSTRUMENT_OPTIONS: ReadonlyArray<{
  id: GlanceAlternateInstrumentId;
  label: string;
}> = [
  { id: "russell2000", label: "Russell 2000" },
  { id: "gold", label: "Gold" },
  { id: "bitcoin", label: "Bitcoin" },
  { id: "us-cl", label: "WTI Crude" },
  { id: "jp-n225", label: "Nikkei 225" },
  { id: "ftse100", label: "FTSE 100" },
];

export const DEFAULT_GLANCE_ALTERNATE_INSTRUMENT_ID: GlanceAlternateInstrumentId = "us-cl";

export function isGlanceAlternateInstrumentId(value: string): value is GlanceAlternateInstrumentId {
  return (GLANCE_ALTERNATE_INSTRUMENT_IDS as readonly string[]).includes(value);
}

export function pickGlanceAlternateCard<T extends { id: string }>(
  cards: T[],
  id: GlanceAlternateInstrumentId,
): T | null {
  return cards.find((card) => card.id === id) ?? cards[0] ?? null;
}
