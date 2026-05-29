import { getSchwabTraderCalendarCapIso, schwabFetch } from "@/lib/schwab/client";
import { SCHWAB_TRANSACTION_CHUNK_DAYS } from "@/lib/schwab/config";
import type { SchwabTxnRaw } from "@/lib/schwab/transactionNormalize";

const DAY_MS = 24 * 3600 * 1000;
const CHUNK_DAYS = SCHWAB_TRANSACTION_CHUNK_DAYS;

function toIsoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** Schwab validates dates in US market calendar; UTC midnight can be "tomorrow" vs ET and triggers 400. */
export function schwabCalendarTodayIso(): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date());
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return toIsoDate(new Date());
  return `${y}-${m}-${d}`;
}

function clampIsoDate(iso: string, maxIso: string): string {
  return iso > maxIso ? maxIso : iso;
}

function addCalendarDays(iso: string, deltaDays: number): string {
  const y = Number(iso.slice(0, 4));
  const mo = Number(iso.slice(5, 7));
  const d = Number(iso.slice(8, 10));
  const utcMs = Date.UTC(y, mo - 1, d) + deltaDays * DAY_MS;
  return new Date(utcMs).toISOString().slice(0, 10);
}

/** Clamp to Schwab-acceptable [start,end] inclusive; invalid ISO → null. */
function normalizeSchwabTransactionWindow(
  startDate: string,
  endDate: string,
  maxCalendarIso: string,
): { start: string; end: string } | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(startDate) || !/^\d{4}-\d{2}-\d{2}$/.test(endDate)) return null;
  const cap = maxCalendarIso <= schwabCalendarTodayIso() ? maxCalendarIso : schwabCalendarTodayIso();
  const end = clampIsoDate(endDate, cap);
  const start = clampIsoDate(startDate, end);
  return { start, end };
}

/** Schwab rejects bare YYYY-MM-DD; use UTC ISO-8601 with start/end-of-day bounds. */
export function schwabTransactionDateParam(calendarIso: string, bound: "start" | "end"): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(calendarIso)) {
    throw new Error(`Invalid calendar date for Schwab transactions: ${calendarIso}`);
  }
  return bound === "start" ? `${calendarIso}T00:00:00.000Z` : `${calendarIso}T23:59:59.000Z`;
}

export type SchwabAccountNumberRow = { accountNumber?: string; hashValue?: string };

/**
 * Fetch TRADE transactions for [startDate, endDate] inclusive (ISO dates).
 */
export async function fetchSchwabTransactionsWindow(
  accountHash: string,
  startDate: string,
  endDate: string,
  maxCalendarIso: string,
  types = "TRADE",
): Promise<SchwabTxnRaw[]> {
  const norm = normalizeSchwabTransactionWindow(startDate, endDate, maxCalendarIso);
  if (!norm) return [];
  const { start, end } = norm;

  const qs = new URLSearchParams({
    types,
    startDate: schwabTransactionDateParam(start, "start"),
    endDate: schwabTransactionDateParam(end, "end"),
  });
  const path = `accounts/${encodeURIComponent(accountHash)}/transactions?${qs.toString()}`;
  const data = await schwabFetch<unknown>(path);
  if (!Array.isArray(data)) return [];
  return data as SchwabTxnRaw[];
}

/**
 * Pull up to `lookbackDays` of history in 59-day chunks (API limit).
 */
export async function fetchSchwabTransactionsChunked(
  accountHash: string,
  lookbackDays: number,
): Promise<SchwabTxnRaw[]> {
  const localNy = schwabCalendarTodayIso();
  const serverNy = await getSchwabTraderCalendarCapIso();
  const endCap = serverNy <= localNy ? serverNy : localNy;

  let chunkEndIso = endCap;
  const all: SchwabTxnRaw[] = [];
  const seen = new Set<string>();

  for (let back = 0; back < lookbackDays; back += CHUNK_DAYS) {
    const chunkStartIso = addCalendarDays(chunkEndIso, -CHUNK_DAYS);
    const batch = await fetchSchwabTransactionsWindow(accountHash, chunkStartIso, chunkEndIso, endCap);
    for (const tx of batch) {
      const id = (tx.activityId ?? tx.transactionId)?.toString() ?? JSON.stringify(tx).slice(0, 80);
      if (seen.has(id)) continue;
      seen.add(id);
      all.push(tx);
    }
    chunkEndIso = chunkStartIso;
  }
  return all;
}

export async function fetchSchwabAccountNumbers(): Promise<SchwabAccountNumberRow[]> {
  return schwabFetch<SchwabAccountNumberRow[]>("accounts/accountNumbers");
}
