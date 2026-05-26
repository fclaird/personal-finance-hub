import { classifyAsset } from "@/lib/analytics/assetClass";
import { normalizeOptionUnderlying } from "@/lib/options/optionUnderlying";

export type TerminalHoldingRow = {
  symbol: string | null;
  securityType: string;
  metadataJson: string | null;
  underlyingSymbol?: string | null;
  underlyingSecurityType?: string | null;
};

/** Individual common stocks and similar direct equity holdings (not funds, bonds, cash, etc.). */
export function isIndividualSecurityHolding(row: TerminalHoldingRow): boolean {
  const st = (row.securityType ?? "").toLowerCase();
  if (st === "cash") return false;
  if (st === "option") {
    return classifyAsset(row.underlyingSecurityType ?? "", null) === "equity";
  }
  return classifyAsset(row.securityType, row.metadataJson) === "equity";
}

export function holdingDisplaySymbol(row: TerminalHoldingRow): string | null {
  const st = (row.securityType ?? "").toLowerCase();
  if (st === "option") {
    return normalizeOptionUnderlying(row.underlyingSymbol, row.symbol);
  }
  const sym = (row.symbol ?? "").trim().toUpperCase();
  return sym || null;
}

/** Symbols to omit from terminal visualizations when "stocks only" is enabled. */
export function collectNonIndividualSecuritySymbols(rows: TerminalHoldingRow[]): string[] {
  const out = new Set<string>();
  for (const row of rows) {
    if (isIndividualSecurityHolding(row)) continue;
    const sym = holdingDisplaySymbol(row);
    if (!sym || sym === "CASH") continue;
    out.add(sym);
  }
  return [...out.values()].sort((a, b) => a.localeCompare(b));
}

export function shouldHideNonIndividualSymbol(
  symbol: string,
  stocksOnly: boolean,
  nonIndividualSymbols: ReadonlySet<string>,
): boolean {
  if (!stocksOnly) return false;
  const sym = (symbol ?? "").trim().toUpperCase();
  return sym.length > 0 && nonIndividualSymbols.has(sym);
}
