import { normalizeOptionUnderlying } from "@/lib/options/optionUnderlying";

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

/** Schwab position `currentDayProfitLoss` from holdings sync metadata_json. */
export function schwabCurrentDayProfitLoss(metadataJson: string | null | undefined): number | null {
  if (!metadataJson?.trim()) return null;
  try {
    const parsed = JSON.parse(metadataJson) as {
      currentDayProfitLoss?: unknown;
      current_day_profit_loss?: unknown;
    };
    return asNumber(parsed.currentDayProfitLoss) ?? asNumber(parsed.current_day_profit_loss);
  } catch {
    return null;
  }
}

export type UnderlyingDayPlPosition = {
  symbol: string | null;
  securityType: string;
  underlyingSymbol?: string | null;
  effectiveUnderlyingSymbol?: string | null;
  metadataJson?: string | null;
};

/** Group key for quotes heatmap rows: equity symbol or option underlying. */
export function underlyingKeyForDayPl(row: UnderlyingDayPlPosition): string | null {
  const sym = (row.symbol ?? "").trim().toUpperCase();
  if (!sym || sym === "CASH") return null;
  if (row.securityType === "option") {
    const u =
      row.effectiveUnderlyingSymbol?.trim().toUpperCase() ||
      normalizeOptionUnderlying(row.underlyingSymbol, row.symbol);
    return u && u !== "CASH" ? u : null;
  }
  return sym;
}

/** Sum Schwab day P/L by underlying (stock + all options on that underlying). */
export function aggregateUnderlyingDayPlFromPositions(
  positions: readonly UnderlyingDayPlPosition[],
): Map<string, number> {
  const out = new Map<string, number>();
  for (const p of positions) {
    const pl = schwabCurrentDayProfitLoss(p.metadataJson);
    if (pl == null) continue;
    const key = underlyingKeyForDayPl(p);
    if (!key) continue;
    out.set(key, (out.get(key) ?? 0) + pl);
  }
  return out;
}
