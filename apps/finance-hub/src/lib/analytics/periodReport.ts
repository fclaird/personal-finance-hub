import type Database from "better-sqlite3";

import { getGlanceAlignedPortfolioValueSeriesByBucket } from "@/lib/analytics/glanceAlignedPerformance";
import type { PortfolioValuePoint } from "@/lib/analytics/performance";
import {
  parsePeriodKind,
  resolvePeriodWindow,
  type PeriodKind,
  type PeriodWindow,
} from "@/lib/analytics/periodWindows";
import { getDb } from "@/lib/db";
import type { FlavorId } from "@/lib/flavor";
import { accountsInFlavorWhereSql } from "@/lib/flavors/accounts";
import { ensureBenchmarkHistory } from "@/lib/market/benchmarks";
import { securityLegsOf, type SchwabTxnItem, type SchwabTxnRaw } from "@/lib/schwab/transactionNormalize";
import { fetchSchwabSessionNetCashFlow } from "@/lib/terminal/portfolioCashFlows";
import { closeOnOrBefore, lastPointOnOrBefore } from "@/lib/portfolio/snapshots";

/** Primary taxable bucket vs all other accounts (retirement, 529, etc.). */
export type RealizedGainScope = "joint_brokerage" | "retirement";

export type RealizedGainsByScope = {
  jointBrokerage: number | null;
  retirement: number | null;
  total: number | null;
};

export type RealizedTradeRow = {
  id: string;
  tradeDate: string;
  accountId: string;
  accountLabel: string;
  scope: RealizedGainScope;
  symbol: string | null;
  description: string | null;
  realizedDollars: number | null;
};

export type PeriodReportMetrics = {
  netBalance: number | null;
  startValue: number | null;
  endValue: number | null;
  plDollars: number | null;
  plPct: number | null;
  sessionCashFlow: number | null;
  realizedGains: RealizedGainsByScope;
  vsSpy: number | null;
  vsQqq: number | null;
  portfolioPct: number | null;
  spyPct: number | null;
  qqqPct: number | null;
};

const JOINT_BROKERAGE_NICKNAME = "joint_brokerage";

/** Classify realized P&L bucket from account nickname (`joint_brokerage` vs everything else). */
export function realizedGainScopeForNickname(nickname: string | null | undefined): RealizedGainScope {
  return (nickname ?? "").trim().toLowerCase() === JOINT_BROKERAGE_NICKNAME ? "joint_brokerage" : "retirement";
}

function accountDisplayLabel(nickname: string | null, name: string): string {
  const n = (nickname ?? "").trim();
  return n || name;
}

function sumRealizedByScope(trades: RealizedTradeRow[]): RealizedGainsByScope {
  let joint = 0;
  let retirement = 0;
  let sawJoint = false;
  let sawRetirement = false;

  for (const t of trades) {
    if (t.realizedDollars == null || !Number.isFinite(t.realizedDollars)) continue;
    if (t.scope === "joint_brokerage") {
      joint += t.realizedDollars;
      sawJoint = true;
    } else {
      retirement += t.realizedDollars;
      sawRetirement = true;
    }
  }

  const jointBrokerage = sawJoint ? Math.round(joint * 100) / 100 : null;
  const retirementTotal = sawRetirement ? Math.round(retirement * 100) / 100 : null;
  const total =
    sawJoint || sawRetirement
      ? Math.round(((jointBrokerage ?? 0) + (retirementTotal ?? 0)) * 100) / 100
      : null;

  return { jointBrokerage, retirement: retirementTotal, total };
}

export type PeriodReportResult = {
  period: PeriodKind;
  window: PeriodWindow;
  metrics: PeriodReportMetrics;
  trades: RealizedTradeRow[];
  tradeLedgerComplete: boolean;
  footnotes: string[];
};

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pickGainLoss(obj: Record<string, unknown>): number | null {
  for (const key of ["gainLoss", "realizedGainLoss", "realizedGain", "gain"]) {
    const n = asNumber(obj[key]);
    if (n != null) return n;
  }
  return null;
}

function legQty(leg: SchwabTxnItem): number | null {
  return asNumber(leg.quantity) ?? asNumber(leg.amount);
}

function legPerUnit(leg: SchwabTxnItem): number | null {
  const qty = legQty(leg);
  const cost = asNumber(leg.cost);
  if (qty == null || cost == null || Math.abs(qty) < 1e-9) return null;
  return Math.abs(cost) / Math.abs(qty);
}

type FifoLot = { qty: number; perUnit: number };

/** Match a CLOSING leg against OPENING lots (FIFO). Exported for tests. */
export function fifoRealizedForClosingLeg(
  lots: FifoLot[],
  closeQty: number,
  closePerUnit: number,
): { gain: number; complete: boolean } {
  let remaining = closeQty;
  let gain = 0;

  while (Math.abs(remaining) > 1e-9) {
    if (lots.length === 0) return { gain, complete: false };
    const lot = lots[0]!;
    if (lot.qty * remaining > 0) return { gain, complete: false };
    const matched = Math.sign(remaining) * Math.min(Math.abs(lot.qty), Math.abs(remaining));
    if (lot.qty > 0) gain += (closePerUnit - lot.perUnit) * Math.abs(matched);
    else gain += (lot.perUnit - closePerUnit) * Math.abs(matched);

    // `matched` already has the closing quantity's sign (opposite the lot).
    // Adding it reduces the lot toward zero; subtracting it doubled leftovers.
    lot.qty += matched;
    remaining -= matched;
    if (Math.abs(lot.qty) < 1e-9) lots.shift();
  }

  return { gain, complete: true };
}

function fifoLotKey(accountId: string, symbol: string): string {
  return `${accountId}::${symbol}`;
}

function openingLotFromLeg(leg: SchwabTxnItem): FifoLot | null {
  const qty = legQty(leg);
  const perUnit = legPerUnit(leg);
  if (qty == null || perUnit == null || Math.abs(qty) < 1e-9) return null;
  return { qty, perUnit };
}

function hasClosingLeg(raw: SchwabTxnRaw): boolean {
  return securityLegsOf(raw).some((leg) => (leg.positionEffect ?? "").toUpperCase() === "CLOSING");
}

/** Parse top-level gainLoss when Schwab provides it. */
export function parseRealizedGainFromRaw(raw: SchwabTxnRaw): number | null {
  const top = pickGainLoss(raw as SchwabTxnRaw & Record<string, unknown>);
  if (top != null) return top;
  if (!hasClosingLeg(raw)) return null;
  return null;
}

/** Load windowed realized trades; FIFO lots include history on or before `endYmd`. Exported for tests. */
export function loadRealizedTrades(
  db: Database.Database,
  flavor: FlavorId,
  startYmd: string,
  endYmd: string,
): { trades: RealizedTradeRow[]; ledgerComplete: boolean } {
  const flavorSql = accountsInFlavorWhereSql(flavor, "a");
  const rows = db
    .prepare(
      `
      SELECT b.id, b.account_id, b.trade_date, b.transaction_type, b.description, b.raw_json, b.symbol,
             a.name AS account_name, a.nickname AS account_nickname
      FROM broker_transactions b
      JOIN accounts a ON a.id = b.account_id
      WHERE b.trade_date <= @endYmd
        AND ${flavorSql}
      ORDER BY b.trade_date ASC, b.id ASC
    `,
    )
    .all({ endYmd }) as Array<{
    id: string;
    account_id: string;
    trade_date: string;
    transaction_type: string | null;
    description: string | null;
    raw_json: string;
    symbol: string | null;
    account_name: string;
    account_nickname: string | null;
  }>;

  const lots = new Map<string, FifoLot[]>();
  const trades: RealizedTradeRow[] = [];
  let ledgerComplete = true;
  let sawTradeInWindow = false;

  for (const row of rows) {
    const txType = (row.transaction_type ?? "").toUpperCase();
    if (txType && txType !== "TRADE") continue;

    const inWindow = row.trade_date >= startYmd && row.trade_date <= endYmd;
    if (inWindow) sawTradeInWindow = true;

    let raw: SchwabTxnRaw;
    try {
      raw = JSON.parse(row.raw_json) as SchwabTxnRaw;
    } catch {
      if (inWindow) ledgerComplete = false;
      continue;
    }

    const scope = realizedGainScopeForNickname(row.account_nickname);
    const accountLabel = accountDisplayLabel(row.account_nickname, row.account_name);
    const topGain = pickGainLoss(raw as SchwabTxnRaw & Record<string, unknown>);
    const fifoTradesForRow: RealizedTradeRow[] = [];

    // Always apply OPENING/CLOSING legs to the FIFO book, including trades before
    // the report window. Skipping out-of-window closes left stale lots in place and
    // attributed later round-trips to the wrong cost basis.
    for (const leg of securityLegsOf(raw)) {
      const effect = (leg.positionEffect ?? "").toUpperCase();
      const sym = leg.instrument?.symbol?.trim();
      if (!sym) continue;

      const key = fifoLotKey(row.account_id, sym);
      if (effect === "OPENING") {
        const lot = openingLotFromLeg(leg);
        if (lot) {
          const bucket = lots.get(key) ?? [];
          bucket.push(lot);
          lots.set(key, bucket);
        }
        continue;
      }

      if (effect !== "CLOSING") continue;

      const qty = legQty(leg);
      const perUnit = legPerUnit(leg);
      if (qty == null || perUnit == null) {
        if (inWindow) {
          ledgerComplete = false;
          fifoTradesForRow.push({
            id: `${row.id}:${sym}`,
            tradeDate: row.trade_date,
            accountId: row.account_id,
            accountLabel,
            scope,
            symbol: sym,
            description: row.description ?? leg.instrument?.description ?? null,
            realizedDollars: null,
          });
        }
        continue;
      }

      const bucket = lots.get(key) ?? [];
      const workingLots = bucket.map((l) => ({ ...l }));
      const { gain, complete } = fifoRealizedForClosingLeg(workingLots, qty, perUnit);
      lots.set(key, workingLots);

      if (!inWindow) continue;

      if (!complete) ledgerComplete = false;

      fifoTradesForRow.push({
        id: `${row.id}:${sym}`,
        tradeDate: row.trade_date,
        accountId: row.account_id,
        accountLabel,
        scope,
        symbol: sym,
        description: row.description ?? leg.instrument?.description ?? null,
        realizedDollars: complete ? gain : null,
      });
    }

    if (topGain != null && inWindow && Math.abs(topGain) >= 1e-9) {
      trades.push({
        id: row.id,
        tradeDate: row.trade_date,
        accountId: row.account_id,
        accountLabel,
        scope,
        symbol: row.symbol,
        description: row.description,
        realizedDollars: topGain,
      });
      continue;
    }

    trades.push(...fifoTradesForRow);
  }

  if (!sawTradeInWindow) ledgerComplete = false;

  trades.sort((a, b) => b.tradeDate.localeCompare(a.tradeDate) || b.id.localeCompare(a.id));
  return { trades, ledgerComplete };
}

export function computePeriodPct(start: number | null, end: number | null): number | null {
  if (start == null || end == null || !Number.isFinite(start) || !Number.isFinite(end) || start <= 0) return null;
  return ((end - start) / start) * 100;
}

export function computeVsBenchmark(portfolioPct: number | null, benchmarkPct: number | null): number | null {
  if (portfolioPct == null || benchmarkPct == null) return null;
  return Math.round((portfolioPct - benchmarkPct) * 100) / 100;
}

export function computePeriodPlFromSeries(
  series: PortfolioValuePoint[],
  startAnchorYmd: string,
  endYmd: string,
  sessionCashFlow = 0,
): {
  startValue: number | null;
  endValue: number | null;
  plDollars: number | null;
  plPct: number | null;
} {
  const startPt = lastPointOnOrBefore(series, startAnchorYmd);
  const endPt = lastPointOnOrBefore(series, endYmd) ?? (series.length ? series[series.length - 1]! : null);

  const startValue = startPt?.totalMarketValue ?? null;
  const endValue = endPt?.totalMarketValue ?? null;

  if (startValue == null || endValue == null) {
    return { startValue, endValue, plDollars: null, plPct: null };
  }

  const plDollars = endValue - startValue - sessionCashFlow;
  const plPct = computePeriodPct(startValue, startValue + plDollars);
  return { startValue, endValue, plDollars, plPct };
}

export function computeBenchmarkPeriodPct(
  db: Database.Database,
  symbol: "SPY" | "QQQ",
  startAnchorYmd: string,
  endYmd: string,
): number | null {
  const startClose = closeOnOrBefore(db, symbol, startAnchorYmd);
  const endClose = closeOnOrBefore(db, symbol, endYmd);
  return computePeriodPct(startClose, endClose);
}


export async function computePeriodReport(options: {
  period: PeriodKind;
  flavor?: FlavorId;
  db?: Database.Database;
  now?: Date;
}): Promise<PeriodReportResult> {
  const db = options.db ?? getDb();
  const flavor = options.flavor ?? "main";
  const now = options.now ?? new Date();
  const window = resolvePeriodWindow(options.period, now);

  const series = getGlanceAlignedPortfolioValueSeriesByBucket("combined", db, flavor);
  const latest = series.length ? series[series.length - 1]! : null;
  const netBalance = latest?.totalMarketValue ?? null;

  let sessionCashFlow: number | null = null;
  if (window.period === "daily") {
    sessionCashFlow = await fetchSchwabSessionNetCashFlow(window.startYmd, db, flavor);
  }

  const { startValue, endValue, plDollars, plPct } = computePeriodPlFromSeries(
    series,
    window.startAnchorYmd,
    window.endYmd,
    sessionCashFlow ?? 0,
  );

  await ensureBenchmarkHistory("SPY", window.endYmd);
  await ensureBenchmarkHistory("QQQ", window.endYmd);

  const spyPct = computeBenchmarkPeriodPct(db, "SPY", window.startAnchorYmd, window.endYmd);
  const qqqPct = computeBenchmarkPeriodPct(db, "QQQ", window.startAnchorYmd, window.endYmd);
  const portfolioPct = plPct;
  const vsSpy = computeVsBenchmark(portfolioPct, spyPct);
  const vsQqq = computeVsBenchmark(portfolioPct, qqqPct);

  const { trades, ledgerComplete } = loadRealizedTrades(db, flavor, window.startYmd, window.endYmd);
  const realizedGainsRaw = sumRealizedByScope(trades);
  const realizedGains =
    realizedGainsRaw.total != null
      ? realizedGainsRaw
      : ledgerComplete
        ? { jointBrokerage: 0, retirement: 0, total: 0 }
        : { jointBrokerage: null, retirement: null, total: null };
  const includeTradeDetails = window.period === "daily" || window.period === "weekly";

  const footnotes: string[] = [];
  if (window.period !== "daily") {
    footnotes.push("Period P&L is net liquidation change; deposits and withdrawals are not stripped.");
  } else if (sessionCashFlow != null && Math.abs(sessionCashFlow) > 1e-6) {
    footnotes.push("Daily P&L excludes session cash flows (deposits and withdrawals).");
  }
  if (!ledgerComplete) {
    footnotes.push("Sync TRADE history on Connections for complete realized gains.");
  } else if (trades.some((t) => t.realizedDollars == null)) {
    footnotes.push(
      "Some closing trades lack opening history in the synced ledger; realized $ may be incomplete.",
    );
  }

  return {
    period: window.period,
    window,
    metrics: {
      netBalance,
      startValue,
      endValue,
      plDollars,
      plPct: plPct != null ? Math.round(plPct * 100) / 100 : null,
      sessionCashFlow,
      realizedGains,
      vsSpy,
      vsQqq,
      portfolioPct: portfolioPct != null ? Math.round(portfolioPct * 100) / 100 : null,
      spyPct: spyPct != null ? Math.round(spyPct * 100) / 100 : null,
      qqqPct: qqqPct != null ? Math.round(qqqPct * 100) / 100 : null,
    },
    trades: includeTradeDetails ? trades : [],
    tradeLedgerComplete: ledgerComplete,
    footnotes,
  };
}

export function parsePeriodReportQuery(periodRaw: string | null | undefined): PeriodKind {
  if (!periodRaw?.trim()) return "daily";
  return parsePeriodKind(periodRaw) ?? "daily";
}
