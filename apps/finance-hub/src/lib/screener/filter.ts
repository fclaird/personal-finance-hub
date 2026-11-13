import { correlationBand, marketCapBand } from "@/lib/screener/bands";
import { CORR_WINDOW_LABEL } from "@/lib/screener/correlation";
import { citedIsBlank } from "@/lib/screener/cited";
import type { Cited, CorrWindow, ScreenerFilters, ScreenerRow } from "@/lib/screener/types";

export const EMPTY_FILTERS: ScreenerFilters = {
  sectors: [],
  marketCapBands: [],
  sizeRankMax: null,
  corrWindow: "1y",
  corrTarget: "qqq",
  corrBand: null,
  corrMin: null,
  corrMax: null,
  peTrailingMin: null,
  peTrailingMax: null,
  peForwardMin: null,
  peForwardMax: null,
  pegMin: null,
  pegMax: null,
  pegMaxInclusive: true,
  psTrailingMin: null,
  psTrailingMax: null,
  psForwardMin: null,
  psForwardMax: null,
  warExposure: [],
  requireCited: true,
};

function numInRange(value: number | null, min: number | null, max: number | null, maxInclusive = true): boolean {
  if (value == null || !Number.isFinite(value)) return false;
  if (min != null && value < min) return false;
  if (max != null && (maxInclusive ? value > max : value >= max)) return false;
  return true;
}

function corrOf(row: ScreenerRow, which: "spy" | "qqq", window: CorrWindow): Cited {
  return which === "spy" ? row.corrSpy[window] : row.corrQqq[window];
}

function formatCorr(value: number): string {
  return value.toFixed(2);
}

export function rowHasCitedFigure(row: ScreenerRow): boolean {
  const numeric = [row.marketCap, row.peTrailing, row.peForward, row.peg, row.psTrailing, row.psForward, row.revenueTtm, row.epsTtm];
  if (numeric.some((cited) => cited.valueNum != null)) return true;
  if (!citedIsBlank(row.war) || !citedIsBlank(row.blurb)) return true;
  for (const window of ["3m", "1y", "3y"] as const) {
    if (row.corrSpy[window].valueNum != null || row.corrQqq[window].valueNum != null) return true;
  }
  return false;
}

export type MatchResult = { ok: boolean; reasons: string[] };

/** Every active predicate must pass. Blank fields fail an active predicate. */
export function matchRow(row: ScreenerRow, filters: ScreenerFilters): MatchResult {
  const reasons: string[] = [];

  if (filters.requireCited) {
    if (!rowHasCitedFigure(row)) return { ok: false, reasons: [] };
    reasons.push("Has a cited figure");
  }

  if (filters.sectors.length > 0) {
    const sector = row.sector.valueText;
    if (!sector || !filters.sectors.includes(sector)) return { ok: false, reasons: [] };
    reasons.push(`Sector ${sector}`);
  }

  if (filters.marketCapBands.length > 0) {
    const band = row.marketCap.valueNum == null ? null : marketCapBand(row.marketCap.valueNum);
    if (!band || !filters.marketCapBands.includes(band)) return { ok: false, reasons: [] };
    reasons.push(`Market cap band ${band}`);
  }

  if (filters.sizeRankMax != null) {
    if (row.sizeRank == null || row.sizeRank > filters.sizeRankMax) return { ok: false, reasons: [] };
    reasons.push(`Size rank ${row.sizeRank} ≤ ${filters.sizeRankMax}`);
  }

  const corrActive = filters.corrBand != null || filters.corrMin != null || filters.corrMax != null;
  if (corrActive) {
    const targets = filters.corrTarget === "both" ? (["spy", "qqq"] as const) : ([filters.corrTarget] as const);
    for (const target of targets) {
      const cited = corrOf(row, target, filters.corrWindow);
      const value = cited.valueNum;
      if (value == null) return { ok: false, reasons: [] };
      if (filters.corrBand && correlationBand(value) !== filters.corrBand) return { ok: false, reasons: [] };
      if (!numInRange(value, filters.corrMin, filters.corrMax)) return { ok: false, reasons: [] };
      const name = target === "spy" ? "SPY" : "QQQ";
      const band = correlationBand(value);
      reasons.push(
        `${name} ${CORR_WINDOW_LABEL[filters.corrWindow]} correlation ${formatCorr(value)}${band ? ` ${band}` : ""}`,
      );
    }
  }

  const ratioChecks: Array<[Cited, number | null, number | null, string, boolean]> = [
    [row.peTrailing, filters.peTrailingMin, filters.peTrailingMax, "Trailing P/E", true],
    [row.peForward, filters.peForwardMin, filters.peForwardMax, "Forward P/E", true],
    [row.peg, filters.pegMin, filters.pegMax, "PEG", filters.pegMaxInclusive],
    [row.psTrailing, filters.psTrailingMin, filters.psTrailingMax, "Trailing P/S", true],
    [row.psForward, filters.psForwardMin, filters.psForwardMax, "Forward P/S", true],
  ];
  for (const [cited, min, max, label, maxInclusive] of ratioChecks) {
    if (min == null && max == null) continue;
    if (!numInRange(cited.valueNum, min, max, maxInclusive)) return { ok: false, reasons: [] };
    const bits: string[] = [];
    if (min != null) bits.push(`≥ ${min}`);
    if (max != null) bits.push(`${maxInclusive ? "≤" : "<"} ${max}`);
    reasons.push(`${label} ${cited.valueNum} ${bits.join(" and ")}`);
  }

  if (filters.warExposure.length > 0) {
    const rating = row.war.valueText;
    if (!rating || !filters.warExposure.includes(rating as (typeof filters.warExposure)[number])) {
      return { ok: false, reasons: [] };
    }
    reasons.push(`War exposure ${rating}`);
  }

  return { ok: true, reasons };
}

export function applyFilters(rows: ScreenerRow[], filters: ScreenerFilters): Array<ScreenerRow & { why: string[] }> {
  const out: Array<ScreenerRow & { why: string[] }> = [];
  for (const row of rows) {
    const match = matchRow(row, filters);
    if (match.ok) out.push({ ...row, why: match.reasons });
  }
  return out;
}
