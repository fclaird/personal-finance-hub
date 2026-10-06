import { endOfMonth, monthOf, monthRange } from "@/lib/realEstate/months";

export type ValueSource = "appraisal" | "assessor" | "manual_avm" | "purchase";

export type ValuationInput = {
  id: string;
  asOf: string;
  valueUsd: number;
  lowUsd: number | null;
  highUsd: number | null;
  source: ValueSource;
  sourceDetail: string | null;
};

export type HpiObservation = {
  period: string;
  index: number;
};

export type OfficialMethod = "appraisal_anchor" | "hpi_from_appraisal" | "avm_blend" | "hpi_from_official";

export type OfficialMonth = {
  month: string;
  valueUsd: number;
  lowUsd: number;
  highUsd: number;
  method: OfficialMethod;
  anchorValuationId: string | null;
  hpiBase: number | null;
  hpiMonth: number | null;
  sourceAsOf: string;
};

/** Standard median. Two readings average; three or more take the middle, or the mean of the two middles. */
export function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  if (sorted.length === 0) throw new Error("median of empty list");
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 1) return sorted[mid]!;
  return (sorted[mid - 1]! + sorted[mid]!) / 2;
}

export function hpiIndexAt(hpi: HpiObservation[], month: string): number | null {
  let best: HpiObservation | null = null;
  for (const row of hpi) {
    if (!row.period || row.period > month || !(row.index > 0)) continue;
    if (!best || row.period > best.period) best = row;
  }
  return best ? best.index : null;
}

function detailKey(detail: string | null): string {
  return (detail ?? "").trim().toLowerCase();
}

function distinctAvms(readings: ValuationInput[], pred: (reading: ValuationInput) => boolean): ValuationInput[] {
  const map = new Map<string, ValuationInput>();
  for (const reading of readings) {
    if (reading.source !== "manual_avm" || !pred(reading)) continue;
    const key = detailKey(reading.sourceDetail);
    if (!key) continue;
    const prev = map.get(key);
    if (!prev || reading.asOf > prev.asOf || (reading.asOf === prev.asOf && reading.id > prev.id)) {
      map.set(key, reading);
    }
  }
  return [...map.values()];
}

function span(reading: ValuationInput): { low: number; high: number } {
  const nums = [reading.valueUsd, reading.lowUsd, reading.highUsd].filter(
    (n): n is number => n != null && Number.isFinite(n),
  );
  return { low: Math.min(...nums), high: Math.max(...nums) };
}

function roundCents(value: number): number {
  return Math.round(value * 100) / 100;
}

function scale(
  value: number,
  low: number,
  high: number,
  fromMonth: string,
  toMonth: string,
  hpi: HpiObservation[],
): { value: number; low: number; high: number; hpiBase: number | null; hpiMonth: number | null } {
  const base = hpiIndexAt(hpi, fromMonth);
  const dest = hpiIndexAt(hpi, toMonth);
  if (base == null || dest == null) return { value, low, high, hpiBase: base, hpiMonth: dest };
  const ratio = dest / base;
  return {
    value: roundCents(value * ratio),
    low: roundCents(low * ratio),
    high: roundCents(high * ratio),
    hpiBase: base,
    hpiMonth: dest,
  };
}

function latestAppraisal(readings: ValuationInput[], monthEnd: string): ValuationInput | null {
  let best: ValuationInput | null = null;
  for (const reading of readings) {
    if (reading.source !== "appraisal" || reading.asOf > monthEnd) continue;
    if (!best || reading.asOf > best.asOf || (reading.asOf === best.asOf && reading.id > best.id)) best = reading;
  }
  return best;
}

/** Latest date inside the newest month that has at least two distinct AVM sources, on or before monthEnd. */
function latestAvmSetAsOf(readings: ValuationInput[], monthEnd: string): string | null {
  const avms = distinctAvms(readings, (reading) => reading.asOf <= monthEnd);
  const byMonth = new Map<string, ValuationInput[]>();
  for (const reading of avms) {
    const month = monthOf(reading.asOf);
    const list = byMonth.get(month) ?? [];
    list.push(reading);
    byMonth.set(month, list);
  }
  let bestMonth: string | null = null;
  let bestAsOf: string | null = null;
  for (const [month, list] of byMonth) {
    if (list.length < 2) continue;
    if (bestMonth == null || month > bestMonth) {
      bestMonth = month;
      bestAsOf = list.reduce((max, reading) => (reading.asOf > max ? reading.asOf : max), list[0]!.asOf);
    }
  }
  return bestAsOf;
}

type OfficialBase = {
  month: string;
  value: number;
  low: number;
  high: number;
  id: string | null;
  sourceAsOf: string;
};

/**
 * Official monthly value.
 * An appraisal on or before the month anchors when it is newer than the latest two-source AVM set.
 * Otherwise a month with at least two distinct AVM sources uses their median.
 * Other months step from the last official value by FHFA HPI.
 * Purchase prices and assessor figures stay out of this series.
 */
export function resolveOfficialSeries(
  readings: ValuationInput[],
  hpi: HpiObservation[],
  throughMonth: string,
): OfficialMonth[] {
  const relevant = readings.filter((reading) => reading.source === "appraisal" || reading.source === "manual_avm");
  if (relevant.length === 0) return [];
  const months = relevant.map((reading) => monthOf(reading.asOf));
  const start = months.reduce((a, b) => (a < b ? a : b));
  const lastReading = months.reduce((a, b) => (a > b ? a : b));
  const end = lastReading > throughMonth ? lastReading : throughMonth;
  const out: OfficialMonth[] = [];
  let base: OfficialBase | null = null;

  for (const month of monthRange(start, end)) {
    const monthEnd = endOfMonth(month);
    const appraisal = latestAppraisal(readings, monthEnd);
    const avmSetAsOf = latestAvmSetAsOf(readings, monthEnd);
    const appraisalWins = appraisal != null && (avmSetAsOf == null || appraisal.asOf > avmSetAsOf);
    if (appraisalWins && appraisal) {
      const raw = span(appraisal);
      const scaled = scale(appraisal.valueUsd, raw.low, raw.high, monthOf(appraisal.asOf), month, hpi);
      out.push({
        month,
        valueUsd: scaled.value,
        lowUsd: scaled.low,
        highUsd: scaled.high,
        method: monthOf(appraisal.asOf) === month ? "appraisal_anchor" : "hpi_from_appraisal",
        anchorValuationId: appraisal.id,
        hpiBase: scaled.hpiBase,
        hpiMonth: scaled.hpiMonth,
        sourceAsOf: appraisal.asOf,
      });
      base = {
        month: monthOf(appraisal.asOf),
        value: appraisal.valueUsd,
        low: raw.low,
        high: raw.high,
        id: appraisal.id,
        sourceAsOf: appraisal.asOf,
      };
      continue;
    }

    const monthAvms = distinctAvms(readings, (reading) => monthOf(reading.asOf) === month);
    if (monthAvms.length >= 2) {
      const value = roundCents(median(monthAvms.map((reading) => reading.valueUsd)));
      const low = roundCents(Math.min(...monthAvms.map((reading) => span(reading).low)));
      const high = roundCents(Math.max(...monthAvms.map((reading) => span(reading).high)));
      const sourceAsOf = monthAvms.reduce((max, reading) => (reading.asOf > max ? reading.asOf : max), monthAvms[0]!.asOf);
      out.push({
        month,
        valueUsd: value,
        lowUsd: low,
        highUsd: high,
        method: "avm_blend",
        anchorValuationId: null,
        hpiBase: null,
        hpiMonth: null,
        sourceAsOf,
      });
      base = { month, value, low, high, id: null, sourceAsOf };
      continue;
    }

    if (base) {
      const scaled = scale(base.value, base.low, base.high, base.month, month, hpi);
      out.push({
        month,
        valueUsd: scaled.value,
        lowUsd: scaled.low,
        highUsd: scaled.high,
        method: "hpi_from_official",
        anchorValuationId: base.id,
        hpiBase: scaled.hpiBase,
        hpiMonth: scaled.hpiMonth,
        sourceAsOf: base.sourceAsOf,
      });
    }
  }
  return out;
}
