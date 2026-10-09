import { findQuote, type OptionChain, type OptionRight } from "@/lib/optionChain/chain";
import { describeVolShift } from "@/lib/strategyLab/internal/pricing";
import type { LabScenario } from "@/lib/strategyLab/lab";

export type SnapshotQuotes = {
  readonly spot: number;
  readonly tradeDate: string;
  readonly contracts: readonly {
    readonly expiry: string;
    readonly right: OptionRight;
    readonly strike: number;
    readonly bid: number | null;
    readonly ask: number | null;
    readonly mid: number | null;
  }[];
};

export type SnapshotProvenance = {
  readonly source: "schwab" | "cboe";
  readonly delayed: boolean;
  readonly timestamp: string | null;
};

export function compactQuotes(chain: OptionChain, scenario: LabScenario): SnapshotQuotes {
  const seen = new Set<string>();
  const contracts: SnapshotQuotes["contracts"][number][] = [];
  for (const structure of scenario.structures) {
    for (const leg of structure.legs) {
      const key = `${structure.expiry}|${leg.right}|${Math.round(leg.strike * 1000)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const quote = findQuote(chain, structure.expiry, leg.right, leg.strike);
      contracts.push({
        expiry: structure.expiry,
        right: leg.right,
        strike: leg.strike,
        bid: quote?.bid ?? null,
        ask: quote?.ask ?? null,
        mid: quote?.mid ?? null,
      });
    }
  }
  return { spot: chain.spot, tradeDate: chain.tradeDate, contracts };
}

export function provenanceFromChain(chain: OptionChain): SnapshotProvenance {
  return {
    source: chain.provenance.source,
    delayed: chain.provenance.delayed,
    timestamp: chain.provenance.quoteTime ?? chain.provenance.fetchedAt,
  };
}

export function defaultSnapshotSummary(scenario: LabScenario): string {
  const names = scenario.structures.map((structure) => structure.label).join(", ") || "No structures";
  const shift = describeVolShift(scenario.assumptions.volShift);
  const text = `${scenario.symbol} · ${names}${shift ? ` · ${shift}` : ""}`;
  return text.slice(0, 160);
}

function isRecord(raw: unknown): raw is Record<string, unknown> {
  return raw != null && typeof raw === "object" && !Array.isArray(raw);
}

function finite(raw: unknown): number | null {
  return typeof raw === "number" && Number.isFinite(raw) ? raw : null;
}

export function parseSnapshotQuotes(raw: unknown): SnapshotQuotes | null {
  if (!isRecord(raw)) return null;
  const spot = finite(raw.spot);
  if (spot == null || !(spot > 0)) return null;
  if (typeof raw.tradeDate !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(raw.tradeDate)) return null;
  if (!Array.isArray(raw.contracts) || raw.contracts.length > 64) return null;
  const contracts: SnapshotQuotes["contracts"][number][] = [];
  for (const item of raw.contracts) {
    if (!isRecord(item)) return null;
    if (item.right !== "C" && item.right !== "P") return null;
    const strike = finite(item.strike);
    if (strike == null || !(strike > 0)) return null;
    if (typeof item.expiry !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(item.expiry)) return null;
    const bid = item.bid == null ? null : finite(item.bid);
    const ask = item.ask == null ? null : finite(item.ask);
    const mid = item.mid == null ? null : finite(item.mid);
    if (item.bid != null && bid == null) return null;
    if (item.ask != null && ask == null) return null;
    if (item.mid != null && mid == null) return null;
    contracts.push({ expiry: item.expiry, right: item.right, strike, bid, ask, mid });
  }
  return { spot, tradeDate: raw.tradeDate, contracts };
}

export function parseSnapshotProvenance(raw: unknown): SnapshotProvenance | null {
  if (!isRecord(raw)) return null;
  if (raw.source !== "schwab" && raw.source !== "cboe") return null;
  if (typeof raw.delayed !== "boolean") return null;
  if (raw.timestamp != null && (typeof raw.timestamp !== "string" || raw.timestamp.length < 1 || raw.timestamp.length > 40)) return null;
  return { source: raw.source, delayed: raw.delayed, timestamp: raw.timestamp ?? null };
}

export function cleanSnapshotSummary(raw: unknown): string | null {
  if (typeof raw !== "string") return null;
  const text = raw.trim();
  if (text.length < 1 || text.length > 160) return null;
  if (/[\u0000-\u001f]/.test(text)) return null;
  return text;
}
