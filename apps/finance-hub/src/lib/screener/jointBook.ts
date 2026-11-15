import type Database from "better-sqlite3";

import { dailyReturns, type DailyReturn, type PriceBar } from "@/lib/screener/correlation";
import { normalizeOptionUnderlying } from "@/lib/options/optionUnderlying";

export type JointPositionInput = {
  securityType: string;
  symbol: string | null;
  underlying: string | null;
  quantity: number | null;
  marketValue: number | null;
  price: number | null;
  delta: number | null;
};

export type JointWeight = { ticker: string; weight: number };

export type JointWeights = {
  weights: JointWeight[];
  stockOnly: boolean;
  omittedOptions: number;
  basis: string;
};

const CONTRACT_MULTIPLIER = 100;

export function isJointBrokerageAccount(nickname: string | null, name: string | null): boolean {
  const text = `${nickname ?? ""} ${name ?? ""}`.toLowerCase().replace(/_/g, " ");
  return /\bjoint\b/.test(text);
}

export function canonicalTicker(symbol: string | null | undefined): string | null {
  const text = (symbol ?? "").trim().toUpperCase().replace(/\./g, "-").replace(/\//g, "-");
  if (!/^[A-Z][A-Z0-9.-]{0,14}$/.test(text)) return null;
  return text;
}

/**
 * Today's signed market-value weights.
 * Options use quantity × 100 × stored delta × the stock's snapshot price when a delta is on file.
 * If no joint option has a stored delta, options are left out and the book is stock-only.
 */
export function jointWeights(positions: JointPositionInput[]): JointWeights {
  const options = positions.filter((row) => row.securityType === "option");
  const anyDelta = options.some((row) => row.delta != null && Number.isFinite(row.delta) && Math.abs(row.delta) > 1e-12);
  const stockPx = new Map<string, number>();
  for (const row of positions) {
    if (row.securityType === "option" || row.securityType === "cash") continue;
    const ticker = canonicalTicker(row.symbol);
    if (!ticker) continue;
    if (row.quantity != null && row.quantity !== 0 && row.marketValue != null && Number.isFinite(row.marketValue)) {
      stockPx.set(ticker, row.marketValue / row.quantity);
    } else if (row.price != null && row.price > 0) {
      stockPx.set(ticker, row.price);
    }
  }

  const byTicker = new Map<string, number>();
  let omittedOptions = 0;
  for (const row of positions) {
    if (row.securityType === "cash") continue;
    if (row.securityType === "option") {
      if (!anyDelta) continue;
      const ticker = canonicalTicker(normalizeOptionUnderlying(row.underlying, row.symbol));
      const px = ticker ? stockPx.get(ticker) : undefined;
      if (
        ticker == null ||
        ticker === "UNKNOWN" ||
        px == null ||
        row.quantity == null ||
        row.delta == null ||
        !Number.isFinite(row.delta) ||
        Math.abs(row.delta) <= 1e-12
      ) {
        omittedOptions += 1;
        continue;
      }
      const exposure = row.quantity * CONTRACT_MULTIPLIER * row.delta * px;
      if (!Number.isFinite(exposure) || exposure === 0) continue;
      byTicker.set(ticker, (byTicker.get(ticker) ?? 0) + exposure);
      continue;
    }
    const ticker = canonicalTicker(row.symbol);
    if (!ticker || row.marketValue == null || !Number.isFinite(row.marketValue) || row.marketValue === 0) continue;
    byTicker.set(ticker, (byTicker.get(ticker) ?? 0) + row.marketValue);
  }

  const stockOnly = options.length > 0 && !anyDelta;
  const basis = stockOnly
    ? "Stock positions only. Joint options have no stored delta, so they are not in the weights."
    : anyDelta
      ? "Weights are today's market value. Options use delta-adjusted underlying exposure from stored deltas. Options without a stored delta are omitted."
      : "Weights are today's market value of stock positions.";
  return {
    weights: [...byTicker.entries()]
      .map(([ticker, weight]) => ({ ticker, weight }))
      .sort((a, b) => a.ticker.localeCompare(b.ticker)),
    stockOnly,
    omittedOptions,
    basis,
  };
}

/** Constant today's weights applied to the intersection of adjusted-close daily returns. */
export function portfolioReturnSeries(
  weights: JointWeight[],
  barsByTicker: Map<string, PriceBar[]>,
): { returns: DailyReturn[]; missing: string[] } | null {
  const missing: string[] = [];
  const series: Array<{ weight: number; returns: DailyReturn[] }> = [];
  for (const row of weights) {
    const bars = barsByTicker.get(row.ticker);
    const returns = bars && bars.length > 0 ? dailyReturns(bars) : [];
    if (returns.length === 0) {
      missing.push(row.ticker);
      continue;
    }
    series.push({ weight: row.weight, returns });
  }
  if (series.length === 0) return null;
  const net = series.reduce((sum, row) => sum + row.weight, 0);
  if (!Number.isFinite(net) || Math.abs(net) < 1e-9) return null;

  let dates = new Set(series[0]!.returns.map((row) => row.date));
  for (const row of series.slice(1)) {
    const own = new Set(row.returns.map((point) => point.date));
    dates = new Set([...dates].filter((date) => own.has(date)));
  }
  const ordered = [...dates].sort();
  const lookups = series.map((row) => ({ weight: row.weight, byDate: new Map(row.returns.map((point) => [point.date, point.value])) }));
  const returns: DailyReturn[] = [];
  for (const date of ordered) {
    let value = 0;
    for (const row of lookups) value += (row.weight / net) * (row.byDate.get(date) ?? 0);
    if (Number.isFinite(value)) returns.push({ date, value });
  }
  return returns.length > 0 ? { returns, missing } : null;
}

export type JointBook = {
  ready: boolean;
  note: string;
  positionsAsOf: string | null;
  accounts: string[];
  weights: JointWeight[];
  stockOnly: boolean;
  omittedOptions: number;
  basis: string;
};

function unavailable(note: string): JointBook {
  return { ready: false, note, positionsAsOf: null, accounts: [], weights: [], stockOnly: false, omittedOptions: 0, basis: "" };
}

type AccountSnap = { id: string; name: string; nickname: string | null; snapshotId: string; asOf: string };

/** Latest snapshot of each account whose nickname or name says Joint. Reads local positions only. */
export function loadJointBook(db: Database.Database): JointBook {
  const hasAccounts = db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='accounts'`).get();
  if (!hasAccounts) return unavailable("Corr to Joint is blank. Positions are unavailable.");
  const snaps = db
    .prepare(
      `SELECT a.id AS id, a.name AS name, a.nickname AS nickname, hs.id AS snapshotId, hs.as_of AS asOf
       FROM accounts a
       JOIN holding_snapshots hs ON hs.account_id = a.id
       WHERE hs.as_of = (SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id)`,
    )
    .all() as AccountSnap[];
  const joint = snaps.filter((row) => isJointBrokerageAccount(row.nickname, row.name));
  if (joint.length === 0) {
    return unavailable("Corr to Joint is blank. No account nickname or name matches Joint brokerage.");
  }
  const ids = joint.map((row) => row.snapshotId);
  const positions = db
    .prepare(
      `SELECT sec.security_type AS securityType, sec.symbol AS symbol, us.symbol AS underlying,
              p.quantity AS quantity, p.market_value AS marketValue, p.price AS price, og.delta AS delta
       FROM positions p
       JOIN securities sec ON sec.id = p.security_id
       LEFT JOIN securities us ON us.id = sec.underlying_security_id
       LEFT JOIN option_greeks og ON og.position_id = p.id
       WHERE p.snapshot_id IN (${ids.map(() => "?").join(",")})`,
    )
    .all(...ids) as JointPositionInput[];
  if (positions.length === 0) {
    return unavailable("Corr to Joint is blank. The Joint brokerage snapshot has no positions.");
  }
  const weighted = jointWeights(positions);
  if (weighted.weights.length === 0) {
    return unavailable("Corr to Joint is blank. The Joint snapshot has no cited stock market value to weight.");
  }
  const asOf = joint.map((row) => row.asOf).sort().at(-1) ?? null;
  const accounts = joint.map((row) => (row.nickname ?? row.name).trim());
  return {
    ready: true,
    note: `${weighted.basis} Positions snapshot ${asOf ?? "undated"} (${accounts.join(", ")}).`,
    positionsAsOf: asOf,
    accounts,
    weights: weighted.weights,
    stockOnly: weighted.stockOnly,
    omittedOptions: weighted.omittedOptions,
    basis: weighted.basis,
  };
}
