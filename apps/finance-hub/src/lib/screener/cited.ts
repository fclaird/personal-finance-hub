import type { Cited, CitedPeer, StoredObservation } from "@/lib/screener/types";
import { EMPTY_CITED } from "@/lib/screener/types";

/** Relative gap above this flags a disagreement. 5% of the larger absolute value. */
export const DISAGREEMENT_THRESHOLD = 0.05;

export function relativeGap(a: number, b: number): number {
  const denom = Math.max(Math.abs(a), Math.abs(b));
  if (denom === 0) return 0;
  return Math.abs(a - b) / denom;
}

export function hasCitedValue(obs: { valueNum?: number | null; valueText?: string | null }): boolean {
  if (typeof obs.valueNum === "number" && Number.isFinite(obs.valueNum)) return true;
  return typeof obs.valueText === "string" && obs.valueText.trim() !== "";
}

function classificationOf(obs: StoredObservation): string | null {
  const value = obs.meta?.classification;
  return typeof value === "string" && value.trim() ? value : null;
}

function textsDisagree(a: string, b: string): boolean {
  return a.trim().toLowerCase().replace(/\s+/g, " ") !== b.trim().toLowerCase().replace(/\s+/g, " ");
}

/**
 * Pick the display value. `priority` is the fallback order.
 * Disagreement is only among readings in the same classification (or among unclassified numbers).
 * A different classification is listed on the citation and does not raise the flag.
 */
export function chooseCited(observations: StoredObservation[], priority: readonly string[]): Cited {
  const present = observations.filter(hasCitedValue);
  if (present.length === 0) return { ...EMPTY_CITED, peers: [] };

  const classes = new Set(present.map(classificationOf).filter((item): item is string => item != null));
  const preferredClass = classes.has("GICS") ? "GICS" : null;
  const pool = preferredClass ? present.filter((obs) => classificationOf(obs) === preferredClass) : present;
  const outside = preferredClass ? present.filter((obs) => classificationOf(obs) !== preferredClass) : [];

  const bySource = new Map<string, StoredObservation>();
  for (const obs of pool) {
    if (!bySource.has(obs.source)) bySource.set(obs.source, obs);
  }
  let chosen: StoredObservation | null = null;
  for (const source of priority) {
    const hit = bySource.get(source);
    if (hit) {
      chosen = hit;
      break;
    }
  }
  if (!chosen) chosen = pool[0] ?? null;
  if (!chosen) return { ...EMPTY_CITED, peers: [] };

  const peers: CitedPeer[] = [];
  let disagreement = false;
  for (const obs of pool) {
    if (obs.source === chosen.source) continue;
    const gap =
      chosen.valueNum != null && obs.valueNum != null ? relativeGap(chosen.valueNum, obs.valueNum) : null;
    if (gap != null && gap > DISAGREEMENT_THRESHOLD) disagreement = true;
    if (gap == null && chosen.valueText && obs.valueText && textsDisagree(chosen.valueText, obs.valueText)) {
      disagreement = true;
    }
    peers.push({
      source: obs.source,
      valueNum: obs.valueNum ?? null,
      valueText: obs.valueText ?? null,
      asOf: obs.asOf ?? null,
      sourceUrl: obs.sourceUrl ?? null,
      relativeGap: gap,
      otherClassification: false,
    });
  }
  for (const obs of outside) {
    peers.push({
      source: obs.source,
      valueNum: obs.valueNum ?? null,
      valueText: obs.valueText ?? null,
      asOf: obs.asOf ?? null,
      sourceUrl: obs.sourceUrl ?? null,
      relativeGap: null,
      otherClassification: true,
    });
  }

  return {
    valueNum: chosen.valueNum ?? null,
    valueText: chosen.valueText ?? null,
    source: chosen.source,
    asOf: chosen.asOf ?? null,
    fetchedAt: chosen.fetchedAt,
    sourceUrl: chosen.sourceUrl ?? null,
    meta: chosen.meta ?? null,
    singleSource: bySource.size === 1,
    disagreement,
    peers,
  };
}

export function citedIsBlank(cited: Cited): boolean {
  return cited.valueNum == null && (cited.valueText == null || cited.valueText.trim() === "");
}
