import type Database from "better-sqlite3";

import { nyYmd } from "@/lib/market/usEquitySession";
import { getDb } from "@/lib/db";
import { logError, logLine } from "@/lib/log";
import { fetchFhfaMasterCsv, parseFhfaMasterCsv } from "@/lib/realEstate/hpi";
import { readSyncStamp, recordSyncStamp } from "@/lib/syncStamp";
import { priorNySessionYmd, resolvePortfolioAccountTotals } from "@/lib/terminal/portfolioAccountTotals";
import type { FlavorId } from "@/lib/flavor";
import {
  currentMonth,
  listHpiPlaceIds,
  loadDashboard,
  recomputeAll,
  replaceHpiObservations,
  syncAmortization,
  type DashboardProperty,
} from "@/lib/realEstate/store";
import type { NetWorthStrip } from "@/lib/realEstate/netWorth";

const SUCCESS_KEY = "real_estate_hpi_month";
const ATTEMPT_KEY = "real_estate_hpi_attempt";
const ATTEMPT_GAP_MS = 6 * 60 * 60 * 1000;

export type RealEstatePayload = {
  ok: true;
  netWorth: NetWorthStrip;
  investableNote: string | null;
  properties: DashboardProperty[];
  hpiFetchedAt: string | null;
};

export async function loadInvestable(db: Database.Database, flavor: FlavorId): Promise<{ value: number; note: string | null }> {
  try {
    const session = nyYmd(new Date());
    const totals = await resolvePortfolioAccountTotals(session, priorNySessionYmd(session), db, flavor);
    if (!totals) return { value: 0, note: "No brokerage total in this database yet." };
    return { value: totals.netValue, note: null };
  } catch {
    return { value: 0, note: "Brokerage total was unavailable." };
  }
}

export async function buildRealEstatePayload(db: Database.Database = getDb(), flavor: FlavorId = "main"): Promise<RealEstatePayload> {
  const investable = await loadInvestable(db, flavor);
  const dash = loadDashboard(db, investable.value, currentMonth());
  return { ok: true, ...dash, investableNote: investable.note };
}

export type MonthlyResult = {
  ok: boolean;
  fetched: boolean;
  skipped: boolean;
  observations: number;
  error?: string;
};

let monthlyRunning = false;

export async function runRealEstateMonthly(opts?: { force?: boolean; now?: Date }): Promise<MonthlyResult> {
  if (monthlyRunning) return { ok: true, fetched: false, skipped: true, observations: 0 };
  monthlyRunning = true;
  const now = opts?.now ?? new Date();
  const month = currentMonth(now);
  try {
    const db = getDb();
    if (!opts?.force) {
      if (readSyncStamp(db, SUCCESS_KEY) === month) return { ok: true, fetched: false, skipped: true, observations: 0 };
      const attempt = readSyncStamp(db, ATTEMPT_KEY);
      if (attempt && now.getTime() - Date.parse(attempt) < ATTEMPT_GAP_MS) {
        return { ok: true, fetched: false, skipped: true, observations: 0 };
      }
    }
    recordSyncStamp(db, ATTEMPT_KEY, now.toISOString());
    const csv = await fetchFhfaMasterCsv();
    const rows = parseFhfaMasterCsv(csv, listHpiPlaceIds(db));
    if (rows.length === 0) throw new Error("FHFA file had no quarterly MSA rows for the tracked places");
    const fetchedAt = now.toISOString();
    replaceHpiObservations(db, rows, fetchedAt);
    recomputeAll(db, month, fetchedAt);
    syncAmortization(db, month, fetchedAt);
    recordSyncStamp(db, SUCCESS_KEY, month);
    logLine(`real_estate_hpi_ok observations=${rows.length} month=${month}`);
    return { ok: true, fetched: true, skipped: false, observations: rows.length };
  } catch (error) {
    logError("real_estate_hpi_failed", error);
    return {
      ok: false,
      fetched: false,
      skipped: false,
      observations: 0,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    monthlyRunning = false;
  }
}

export async function maybeSyncRealEstateMonthly(now = new Date()): Promise<void> {
  const result = await runRealEstateMonthly({ now });
  if (!result.ok) logError("scheduler_real_estate_failed", result.error ?? "real estate monthly failed");
}
