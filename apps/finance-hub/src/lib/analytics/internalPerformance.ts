import { daysBetween, parseOptionFromSchwabSymbol } from "@/lib/strategy/optionParse";
import { isButterflyStructure, type OptionLegView } from "@/lib/strategy/optionStructures";
import { fifoRealizedForClosingLeg } from "@/lib/analytics/periodReport";
import { isNyTradingDayYmd } from "@/lib/analytics/periodWindows";
import { securityLegsOf, type SchwabTxnItem, type SchwabTxnRaw } from "@/lib/schwab/transactionNormalize";
import { inferInstructionKind } from "@/lib/situations/fromBrokerTx";

const SYNTHETIC_SPAN_MUST_EXCEED_DAYS = 180;
const FLAT_GAP_TRADING_DAYS = 5;
const CONTRACT_SHARES = 100;
const STOCK_MARK_MAX_AGE_DAYS = 5;
const DEEP_ITM_MARK_OVER_STRIKE = 1.1;
const TINY_DENOMINATOR = 1;
export const INTERNAL_DEFAULT_ON_LIMIT = 8;
export const INTERNAL_RETURN_METHODS = ["capital", "twr", "dietz", "exposure"] as const;
export type InternalReturnMethod = (typeof INTERNAL_RETURN_METHODS)[number];

export function parseInternalReturnMethod(value: string | null | undefined): InternalReturnMethod | null {
  if (value == null || value === "") return "capital";
  return (INTERNAL_RETURN_METHODS as readonly string[]).includes(value) ? (value as InternalReturnMethod) : null;
}

export function snapshotMarkPerShare(input: {
  quantity: number;
  marketValue: number | null;
  metadataJson?: string | null;
}): number | null {
  const perShare = (marketValue: number, quantity: number): number | null => {
    if (!Number.isFinite(marketValue) || !Number.isFinite(quantity) || quantity === 0) return null;
    const mark = Math.abs(marketValue / quantity);
    return mark > 0 && Number.isFinite(mark) ? mark : null;
  };
  if (input.marketValue != null) {
    const fromColumn = perShare(input.marketValue, input.quantity);
    if (fromColumn != null) return fromColumn;
  }
  if (!input.metadataJson) return null;
  try {
    const meta = JSON.parse(input.metadataJson) as {
      marketValue?: unknown;
      longQuantity?: unknown;
      shortQuantity?: unknown;
    };
    if (typeof meta.marketValue !== "number" || !Number.isFinite(meta.marketValue)) return null;
    const longQty = typeof meta.longQuantity === "number" && Number.isFinite(meta.longQuantity) ? meta.longQuantity : 0;
    const shortQty = typeof meta.shortQuantity === "number" && Number.isFinite(meta.shortQuantity) ? meta.shortQuantity : 0;
    const qty = longQty !== 0 ? longQty : input.quantity !== 0 ? input.quantity : longQty - shortQty;
    return perShare(meta.marketValue, qty);
  } catch {
    return null;
  }
}

export function freshAccountIds(accounts: Array<{ accountId: string; lastSnapshot: string }>): Set<string> {
  let newest = "";
  for (const row of accounts) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(row.lastSnapshot) && row.lastSnapshot > newest) newest = row.lastSnapshot;
  }
  const fresh = new Set<string>();
  if (!newest) return fresh;
  for (const row of accounts) {
    if (!row.accountId || !/^\d{4}-\d{2}-\d{2}$/.test(row.lastSnapshot)) continue;
    const age = daysBetween(row.lastSnapshot, newest);
    if (age != null && age <= STOCK_MARK_MAX_AGE_DAYS) fresh.add(row.accountId);
  }
  return fresh;
}

export type InternalFillLeg = "share" | "call" | "put";

export type InternalFill = {
  accountId: string;
  date: string;
  underlying: string;
  leg: InternalFillLeg;
  /** Shares, or option contracts times 100. Positive buys, negative sells. */
  signedShares: number;
  /** Share price, or option premium per share. */
  price: number;
  strike: number | null;
  expiration: string | null;
  /** Raw OCC symbol, including the internal spaces Schwab stores. */
  occ?: string;
  seeded?: boolean;
};

export type QualifyReason = "shares" | "synthetic" | "both";

export type QualifiedUnderlying = {
  symbol: string;
  reason: QualifyReason;
  marketValue: number;
};

export type OpenHolding = {
  symbol: string;
  leg: InternalFillLeg;
  quantity: number;
  strike: number | null;
  expiration: string | null;
  marketValue: number;
};

export type InternalAudit = {
  symbol: string;
  method: InternalReturnMethod;
  pnl: number;
  denominator: number;
  capital: number;
  returnPct: number | null;
  stockPct: number | null;
  fallback: boolean;
  /** Exposure used a guessed delta for an open leg. Other methods leave this false. */
  approx: boolean;
  /** Exposure has no underlying mark on the audit date, so the return is blank. */
  unpriced: boolean;
  /** Open synthetic option legs on the audit date. */
  openLegs: number;
  /** Those legs with a stored delta within five days. */
  deltaLegs: number;
};

export type OptionDeltaPoint = {
  underlying: string;
  right: "C" | "P";
  strike: number;
  expiration: string;
  date: string;
  delta: number;
  /** Raw OCC symbol from securities.symbol. */
  occ?: string;
};

export type InternalSeriesPoint = {
  date: string;
  returnPct: number | null;
  stockPct: number | null;
};

export type SharePricePoint = { date: string; price: number };

export type OptionMarkPoint = {
  underlying: string;
  right: "C" | "P";
  strike: number;
  expiration: string;
  date: string;
  price: number;
};

type Window = { start: string; end: string };

type Lot = { qty: number; perUnit: number };

type ContractBook = {
  right: "C" | "P";
  strike: number;
  expiration: string;
  lots: Lot[];
  occ?: string;
};

type AccountBook = {
  shareLots: Lot[];
  contracts: Map<string, ContractBook>;
};

type Interval = { start: string; end: string };

type WorkingLeg = {
  key: string;
  right: "C" | "P";
  strike: number;
  expiration: string;
  qty: number;
};

export type StoredBrokerFillRow = {
  account_id: string;
  trade_date: string;
  transaction_type: string | null;
  raw_json: string | null;
  symbol: string | null;
  underlying_symbol: string | null;
  asset_type: string | null;
  instruction: string | null;
  position_effect: string | null;
  quantity: number | null;
  price: number | null;
  option_expiration: string | null;
  option_right: string | null;
  option_strike: number | null;
};

function addDays(ymd: string, n: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y!, (m ?? 1) - 1, (d ?? 1) + n)).toISOString().slice(0, 10);
}

function tradingDaysStrictlyBetween(earlier: string, later: string): number {
  if (later <= earlier) return 0;
  let n = 0;
  let cursor = earlier;
  while (cursor < later) {
    cursor = addDays(cursor, 1);
    if (cursor >= later) break;
    if (isNyTradingDayYmd(cursor)) n += 1;
  }
  return n;
}

function contractKey(right: "C" | "P", strike: number, expiration: string): string {
  return `${right}|${strike}|${expiration}`;
}

function qtyOf(lots: Lot[]): number {
  return lots.reduce((sum, lot) => sum + lot.qty, 0);
}

function newBook(): AccountBook {
  return { shareLots: [], contracts: new Map() };
}

function applyLot(lots: Lot[], signedQty: number, price: number): number {
  if (Math.abs(signedQty) < 1e-9) return 0;
  const open = qtyOf(lots);
  const sameWay = Math.abs(open) < 1e-9 || Math.sign(signedQty) === Math.sign(open);
  if (sameWay) {
    lots.push({ qty: signedQty, perUnit: price });
    return 0;
  }
  return fifoRealizedForClosingLeg(lots, signedQty, price).gain;
}

function reduceSide(legs: WorkingLeg[], amount: number, side: "long" | "short") {
  let left = amount;
  const targets = legs
    .filter((leg) => (side === "long" ? leg.qty > 0 : leg.qty < 0))
    .sort((a, b) => a.strike - b.strike || a.key.localeCompare(b.key));
  for (const leg of targets) {
    if (left <= 1e-9) break;
    const avail = Math.abs(leg.qty);
    const take = Math.min(avail, left);
    leg.qty = side === "long" ? leg.qty - take : leg.qty + take;
    left -= take;
  }
}

function matchSameRight(legs: WorkingLeg[]) {
  for (const right of ["C", "P"] as const) {
    const same = legs.filter((leg) => leg.right === right);
    const longQty = same.reduce((sum, leg) => sum + (leg.qty > 0 ? leg.qty : 0), 0);
    const shortQty = same.reduce((sum, leg) => sum + (leg.qty < 0 ? Math.abs(leg.qty) : 0), 0);
    const matched = Math.min(longQty, shortQty);
    if (matched <= 1e-9) continue;
    reduceSide(same, matched, "long");
    reduceSide(same, matched, "short");
  }
}

function matchStrangle(legs: WorkingLeg[]) {
  const shortCalls = legs
    .filter((leg) => leg.right === "C" && leg.qty < 0)
    .reduce((sum, leg) => sum + Math.abs(leg.qty), 0);
  const shortPuts = legs
    .filter((leg) => leg.right === "P" && leg.qty < 0)
    .reduce((sum, leg) => sum + Math.abs(leg.qty), 0);
  const matched = Math.min(shortCalls, shortPuts);
  if (matched <= 1e-9) return;
  reduceSide(
    legs.filter((leg) => leg.right === "C"),
    matched,
    "short",
  );
  reduceSide(
    legs.filter((leg) => leg.right === "P"),
    matched,
    "short",
  );
}

function syntheticQtyByContract(contracts: Map<string, ContractBook>): Map<string, number> {
  const open: WorkingLeg[] = [];
  for (const [key, contract] of contracts) {
    const qty = qtyOf(contract.lots);
    if (Math.abs(qty) < 1e-6 || !contract.expiration) continue;
    open.push({
      key,
      right: contract.right,
      strike: contract.strike,
      expiration: contract.expiration,
      qty,
    });
  }

  const byExp = new Map<string, WorkingLeg[]>();
  for (const leg of open) {
    const bucket = byExp.get(leg.expiration) ?? [];
    bucket.push(leg);
    byExp.set(leg.expiration, bucket);
  }

  const synthetic = new Map<string, number>();
  for (const legs of byExp.values()) {
    const views: OptionLegView[] = legs.map((leg) => ({
      right: leg.right,
      strike: leg.strike,
      expiration: leg.expiration,
      instruction: leg.qty < 0 ? "sell_open" : "buy_open",
      opening: true,
      quantity: Math.abs(leg.qty) / CONTRACT_SHARES,
    }));
    const working = legs.map((leg) => ({ ...leg }));
    if (!isButterflyStructure(views)) {
      matchSameRight(working);
      matchStrangle(working);
    } else {
      working.length = 0;
    }
    for (const leg of working) {
      if (leg.right === "C" && leg.qty > 1e-6) synthetic.set(leg.key, (synthetic.get(leg.key) ?? 0) + leg.qty);
      if (leg.right === "P" && leg.qty < -1e-6) synthetic.set(leg.key, (synthetic.get(leg.key) ?? 0) + leg.qty);
    }
  }
  return synthetic;
}

function bookSyntheticAbs(book: AccountBook): number {
  let n = 0;
  for (const qty of syntheticQtyByContract(book.contracts).values()) n += Math.abs(qty);
  return n;
}

function bookShareQty(book: AccountBook): number {
  return qtyOf(book.shareLots);
}

type DayBooks = Map<string, AccountBook>;

function ensureAccount(books: DayBooks, accountId: string): AccountBook {
  const existing = books.get(accountId);
  if (existing) return existing;
  const created = newBook();
  books.set(accountId, created);
  return created;
}

function contractFor(book: AccountBook, fill: InternalFill): ContractBook {
  const right: "C" | "P" = fill.leg === "put" ? "P" : "C";
  const strike = fill.strike ?? 0;
  const expiration = fill.expiration ?? "";
  const key = contractKey(right, strike, expiration);
  const existing = book.contracts.get(key);
  if (existing) {
    if (!existing.occ && fill.occ) existing.occ = fill.occ;
    return existing;
  }
  const created: ContractBook = { right, strike, expiration, lots: [], occ: fill.occ };
  book.contracts.set(key, created);
  return created;
}

function applyShareFill(lots: Lot[], signedQty: number, price: number): number {
  if (signedQty > 0) {
    lots.push({ qty: signedQty, perUnit: price });
    return 0;
  }
  return fifoRealizedForClosingLeg(lots, signedQty, price).gain;
}

function applyFill(book: AccountBook, fill: InternalFill, syntheticAtOpen: Map<string, number>): { shareGain: number; syntheticGain: number } {
  if (fill.leg === "share") {
    return { shareGain: applyShareFill(book.shareLots, fill.signedShares, fill.price), syntheticGain: 0 };
  }
  const contract = contractFor(book, fill);
  const key = contractKey(contract.right, contract.strike, contract.expiration);
  const gain = applyLot(contract.lots, fill.signedShares, fill.price);
  const wasSynthetic = Math.abs(syntheticAtOpen.get(key) ?? 0) > 1e-6;
  return { shareGain: 0, syntheticGain: wasSynthetic ? gain : 0 };
}

function intervalsFromFlags(dates: string[], held: boolean[], asOf: string): Interval[] {
  const intervals: Interval[] = [];
  let openSince: string | null = null;
  for (let i = 0; i < dates.length; i++) {
    const date = dates[i]!;
    if (held[i] && openSince == null) openSince = date;
    if (!held[i] && openSince != null) {
      intervals.push({ start: openSince, end: date });
      openSince = null;
    }
  }
  if (openSince != null) intervals.push({ start: openSince, end: asOf });
  return intervals;
}

function mergeSyntheticEpisodes(intervals: Interval[]): Interval[] {
  if (intervals.length === 0) return [];
  const sorted = [...intervals].sort((a, b) => a.start.localeCompare(b.start));
  const merged: Interval[] = [];
  let current = sorted[0]!;
  for (let i = 1; i < sorted.length; i++) {
    const next = sorted[i]!;
    if (tradingDaysStrictlyBetween(current.end, next.start) < FLAT_GAP_TRADING_DAYS) {
      current = { start: current.start, end: next.end > current.end ? next.end : current.end };
    } else {
      merged.push(current);
      current = next;
    }
  }
  merged.push(current);
  return merged;
}

function overlaps(interval: Interval, window: Window | undefined): boolean {
  if (!window) return true;
  return interval.start <= window.end && interval.end >= window.start;
}

function syntheticQualifies(intervals: Interval[], window: Window | undefined): boolean {
  return mergeSyntheticEpisodes(intervals).some(
    (episode) => overlaps(episode, window) && (daysBetween(episode.start, episode.end) ?? 0) > SYNTHETIC_SPAN_MUST_EXCEED_DAYS,
  );
}

function shareQualifies(intervals: Interval[], window: Window | undefined): boolean {
  return intervals.some((interval) => overlaps(interval, window));
}

function syntheticHeldNow(fills: InternalFill[], asOf: string): Interval | null {
  const dates = visitDates(
    fills.map((fill) => fill.date),
    [],
    asOf,
  );
  const snaps = replaySymbol(fills, dates);
  const intervals = intervalsFromFlags(
    snaps.map((snap) => snap.date),
    snaps.map((snap) => snap.syntheticHeld),
    asOf,
  );
  const episodes = mergeSyntheticEpisodes(intervals);
  return episodes.find((episode) => episode.start <= asOf && episode.end >= asOf) ?? null;
}

export function exposureFromOpenHoldings(
  holdings: OpenHolding[],
): Map<string, { shares: number; synthetic: number; marketValue: number }> {
  const grouped = new Map<string, OpenHolding[]>();
  for (const holding of holdings) {
    const symbol = holding.symbol.trim().toUpperCase();
    if (!symbol || symbol === "CASH") continue;
    const list = grouped.get(symbol) ?? [];
    list.push({ ...holding, symbol });
    grouped.set(symbol, list);
  }
  const out = new Map<string, { shares: number; synthetic: number; marketValue: number }>();
  for (const [symbol, rows] of grouped) {
    let shares = 0;
    let shareMv = 0;
    const contracts = new Map<string, ContractBook>();
    const mvByKey = new Map<string, number>();
    for (const row of rows) {
      if (row.leg === "share") {
        shares += row.quantity;
        shareMv += Math.abs(row.marketValue);
        continue;
      }
      if (!row.expiration || row.strike == null || Math.abs(row.quantity) < 1e-9) continue;
      const right: "C" | "P" = row.leg === "put" ? "P" : "C";
      const key = contractKey(right, row.strike, row.expiration);
      const contract = contracts.get(key) ?? { right, strike: row.strike, expiration: row.expiration, lots: [] };
      contract.lots.push({ qty: row.quantity, perUnit: 0 });
      contracts.set(key, contract);
      mvByKey.set(key, (mvByKey.get(key) ?? 0) + Math.abs(row.marketValue));
    }
    const syntheticMap = syntheticQtyByContract(contracts);
    let synthetic = 0;
    let syntheticMv = 0;
    for (const [key, qty] of syntheticMap) {
      synthetic += Math.abs(qty);
      const open = Math.abs(qtyOf(contracts.get(key)?.lots ?? []));
      const fraction = open > 1e-9 ? Math.min(1, Math.abs(qty) / open) : 0;
      syntheticMv += (mvByKey.get(key) ?? 0) * fraction;
    }
    if (shares <= 1e-6 && synthetic <= 1e-6) continue;
    out.set(symbol, { shares, synthetic, marketValue: shareMv + syntheticMv });
  }
  return out;
}

export function looksLikeCusip(symbol: string): boolean {
  return /^[0-9A-Z]{8,9}$/.test(symbol) && /\d/.test(symbol);
}

export function cusipTickerMap(
  rows: Array<{ symbol: string; cusip: string; securityType?: string | null }>,
): Map<string, string> {
  const map = new Map<string, string>();
  const rank = new Map<string, number>();
  for (const row of rows) {
    const cusip = row.cusip.trim().toUpperCase();
    const symbol = row.symbol.trim().toUpperCase();
    if (!looksLikeCusip(cusip) || !symbol || looksLikeCusip(symbol)) continue;
    const preference = (row.securityType ?? "").toLowerCase() === "equity" ? 2 : 1;
    if ((rank.get(cusip) ?? 0) > preference) continue;
    map.set(cusip, symbol);
    rank.set(cusip, preference);
  }
  return map;
}

export function canonicalSymbol(symbol: string, cusips: Map<string, string>): string | null {
  const trimmed = symbol.trim().toUpperCase();
  if (!trimmed || trimmed === "CASH") return null;
  if (!looksLikeCusip(trimmed)) return trimmed;
  return cusips.get(trimmed) ?? null;
}

export type ShareCloseRow = { symbol: string; date: string; price: number; provider?: string | null };

export function shareClosesBySymbol(rows: ShareCloseRow[]): Record<string, SharePricePoint[]> {
  const hasSchwab = new Set<string>();
  for (const row of rows) {
    if ((row.provider ?? "schwab").trim().toLowerCase() === "schwab") hasSchwab.add(row.symbol.trim().toUpperCase());
  }
  const best = new Map<string, { price: number; schwab: boolean }>();
  for (const row of rows) {
    const symbol = row.symbol.trim().toUpperCase();
    const date = row.date.slice(0, 10);
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(date) || !(row.price > 0)) continue;
    const schwab = (row.provider ?? "schwab").trim().toLowerCase() === "schwab";
    if (hasSchwab.has(symbol) && !schwab) continue;
    const key = `${symbol}|${date}`;
    const prev = best.get(key);
    if (!prev || (schwab && !prev.schwab)) best.set(key, { price: row.price, schwab });
  }
  const out: Record<string, SharePricePoint[]> = {};
  for (const [key, value] of best) {
    const split = key.indexOf("|");
    const symbol = key.slice(0, split);
    const date = key.slice(split + 1);
    const list = out[symbol] ?? [];
    list.push({ date, price: value.price });
    out[symbol] = list;
  }
  for (const list of Object.values(out)) list.sort((a, b) => a.date.localeCompare(b.date));
  return out;
}

export function mergeShareMarks(closes: SharePricePoint[], snapshots: SharePricePoint[]): SharePricePoint[] {
  const byDate = new Map<string, number>();
  for (const close of closes) {
    if (/^\d{4}-\d{2}-\d{2}$/.test(close.date) && close.price > 0) byDate.set(close.date, close.price);
  }
  for (const snap of snapshots) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(snap.date) || !(snap.price > 0) || byDate.has(snap.date)) continue;
    byDate.set(snap.date, snap.price);
  }
  return [...byDate.entries()]
    .map(([date, price]) => ({ date, price }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function groupFills(fills: InternalFill[]): Map<string, InternalFill[]> {
  const bySymbol = new Map<string, InternalFill[]>();
  for (const fill of fills) {
    const symbol = fill.underlying.trim().toUpperCase();
    if (!symbol || symbol === "CASH") continue;
    if (!(fill.price > 0) || Math.abs(fill.signedShares) < 1e-9) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(fill.date)) continue;
    const list = bySymbol.get(symbol) ?? [];
    list.push({ ...fill, underlying: symbol, accountId: fill.accountId || "default" });
    bySymbol.set(symbol, list);
  }
  for (const list of bySymbol.values()) {
    list.sort((a, b) => a.date.localeCompare(b.date) || a.accountId.localeCompare(b.accountId));
  }
  return bySymbol;
}

function visitDates(fillDates: string[], extra: string[], asOf: string): string[] {
  const set = new Set<string>(fillDates.filter((date) => date <= asOf));
  for (const date of extra) if (date <= asOf) set.add(date);
  set.add(asOf);
  return [...set].sort();
}

type ReplaySnap = {
  date: string;
  shareHeld: boolean;
  syntheticHeld: boolean;
  shareRealized: number;
  syntheticRealized: number;
  books: DayBooks;
};

function cloneBooks(books: DayBooks): DayBooks {
  const copy: DayBooks = new Map();
  for (const [accountId, book] of books) {
    const contracts = new Map<string, ContractBook>();
    for (const [key, contract] of book.contracts) {
      contracts.set(key, {
        right: contract.right,
        strike: contract.strike,
        expiration: contract.expiration,
        occ: contract.occ,
        lots: contract.lots.map((lot) => ({ ...lot })),
      });
    }
    copy.set(accountId, {
      shareLots: book.shareLots.map((lot) => ({ ...lot })),
      contracts,
    });
  }
  return copy;
}

function replaySymbol(fills: InternalFill[], dates: string[]): ReplaySnap[] {
  const books: DayBooks = new Map();
  let shareRealized = 0;
  let syntheticRealized = 0;
  let cursor = 0;
  const snaps: ReplaySnap[] = [];
  for (const date of dates) {
    const syntheticAtOpen = new Map<string, Map<string, number>>();
    for (const [accountId, book] of books) syntheticAtOpen.set(accountId, syntheticQtyByContract(book.contracts));
    while (cursor < fills.length && fills[cursor]!.date === date) {
      const fill = fills[cursor]!;
      cursor += 1;
      const book = ensureAccount(books, fill.accountId);
      const prior = syntheticAtOpen.get(fill.accountId) ?? new Map();
      const gain = applyFill(book, fill, prior);
      shareRealized += gain.shareGain;
      syntheticRealized += gain.syntheticGain;
    }
    let shareHeld = false;
    let syntheticHeld = false;
    for (const book of books.values()) {
      if (bookShareQty(book) > 1e-6) shareHeld = true;
      if (bookSyntheticAbs(book) > 1e-6) syntheticHeld = true;
    }
    snaps.push({
      date,
      shareHeld,
      syntheticHeld,
      shareRealized,
      syntheticRealized,
      books: cloneBooks(books),
    });
  }
  return snaps;
}

function classifySymbol(fills: InternalFill[], asOf: string, window: Window | undefined): QualifyReason | null {
  const dates = visitDates(
    fills.map((fill) => fill.date),
    [],
    asOf,
  );
  const snaps = replaySymbol(fills, dates);
  const shareIntervals = intervalsFromFlags(
    snaps.map((snap) => snap.date),
    snaps.map((snap) => snap.shareHeld),
    asOf,
  );
  const syntheticIntervals = intervalsFromFlags(
    snaps.map((snap) => snap.date),
    snaps.map((snap) => snap.syntheticHeld),
    asOf,
  );
  const shares = shareQualifies(shareIntervals, window);
  const synthetic = syntheticQualifies(syntheticIntervals, window);
  if (shares && synthetic) return "both";
  if (shares) return "shares";
  if (synthetic) return "synthetic";
  return null;
}

export function qualifyInternalUnderlyings(
  fills: InternalFill[],
  asOf: string,
  window?: Window,
  openHoldings?: OpenHolding[],
): QualifiedUnderlying[] {
  const grouped = groupFills(fills);
  const exposure = openHoldings ? exposureFromOpenHoldings(openHoldings) : null;
  const out: QualifiedUnderlying[] = [];
  const symbols = new Set<string>([...grouped.keys(), ...(exposure ? exposure.keys() : [])]);
  for (const symbol of symbols) {
    const symbolFills = grouped.get(symbol) ?? [];
    if (!exposure) {
      const reason = classifySymbol(symbolFills, asOf, window);
      if (reason) out.push({ symbol, reason, marketValue: 0 });
      continue;
    }
    const open = exposure.get(symbol);
    const shares = (open?.shares ?? 0) > 1e-6;
    const episode = syntheticHeldNow(symbolFills, asOf);
    const synthetic =
      (open?.synthetic ?? 0) > 1e-6 &&
      episode != null &&
      (daysBetween(episode.start, episode.end) ?? 0) > SYNTHETIC_SPAN_MUST_EXCEED_DAYS;
    if (!shares && !synthetic) continue;
    const reason: QualifyReason = shares && synthetic ? "both" : shares ? "shares" : "synthetic";
    out.push({ symbol, reason, marketValue: open?.marketValue ?? 0 });
  }
  out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return out;
}

export type ShareHoldingSnapshot = {
  accountId: string;
  symbol: string;
  date: string;
  quantity: number;
  price: number | null;
};

export type ShareSnapshotRow = ShareHoldingSnapshot & { asOf: string };

export function latestShareSnapshotsByDay(rows: ShareSnapshotRow[]): ShareSnapshotRow[] {
  const byShot = new Map<string, ShareSnapshotRow>();
  for (const row of rows) {
    const symbol = row.symbol.trim().toUpperCase();
    const date = row.date.slice(0, 10);
    const asOf = row.asOf || date;
    if (!symbol || symbol === "CASH" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(row.quantity)) continue;
    const accountId = row.accountId || "default";
    const key = `${accountId}|${symbol}|${asOf}`;
    const prev = byShot.get(key);
    if (!prev) {
      byShot.set(key, { accountId, symbol, date, asOf, quantity: row.quantity, price: row.price });
      continue;
    }
    const prevQty = prev.quantity;
    prev.quantity += row.quantity;
    if (prev.price != null && prev.price > 0 && row.price != null && row.price > 0 && prev.quantity !== 0) {
      prev.price = (prev.price * prevQty + row.price * row.quantity) / prev.quantity;
    } else if (!(prev.price != null && prev.price > 0) && row.price != null && row.price > 0) {
      prev.price = row.price;
    }
  }
  const byDay = new Map<string, ShareSnapshotRow>();
  for (const row of byShot.values()) {
    const key = `${row.accountId}|${row.symbol}|${row.date}`;
    const prev = byDay.get(key);
    if (!prev || row.asOf > prev.asOf) byDay.set(key, row);
  }
  return [...byDay.values()];
}

function netShareFills(fills: InternalFill[], accountId: string, symbol: string, afterDate: string, throughDate: string): number {
  let net = 0;
  for (const fill of fills) {
    if (fill.seeded || fill.leg !== "share") continue;
    if ((fill.accountId || "default") !== accountId) continue;
    if (fill.underlying.trim().toUpperCase() !== symbol) continue;
    if (fill.date <= afterDate || fill.date > throughDate) continue;
    net += fill.signedShares;
  }
  return net;
}

function snapshotShareQtyByAccount(
  rows: ShareSnapshotRow[],
  symbol: string,
  date: string,
  fills: InternalFill[],
): Map<string, number> | null {
  const mine = rows.filter((row) => row.symbol === symbol);
  if (mine.length === 0) return null;
  const out = new Map<string, number>();
  for (const accountId of new Set(mine.map((row) => row.accountId))) {
    const history = mine
      .filter((row) => row.accountId === accountId)
      .sort((a, b) => a.date.localeCompare(b.date) || a.asOf.localeCompare(b.asOf));
    const past = history.filter((row) => row.date <= date);
    if (past.length > 0) {
      out.set(accountId, Math.max(0, past[past.length - 1]!.quantity));
      continue;
    }
    const future = history.find((row) => row.date > date);
    if (!future) continue;
    const qty = future.quantity - netShareFills(fills, accountId, symbol, date, future.date);
    out.set(accountId, Math.max(0, qty));
  }
  return out.size > 0 ? out : null;
}

function shareBookQty(fills: InternalFill[], accountId: string, symbol: string, throughDate: string): number {
  const lots: Lot[] = [];
  const ordered = fills
    .filter(
      (fill) =>
        fill.leg === "share" &&
        (fill.accountId || "default") === accountId &&
        fill.underlying.trim().toUpperCase() === symbol &&
        fill.date <= throughDate,
    )
    .sort((a, b) => a.date.localeCompare(b.date));
  for (const fill of ordered) {
    if (!(fill.price > 0) || Math.abs(fill.signedShares) < 1e-9) continue;
    applyShareFill(lots, fill.signedShares, fill.price);
  }
  return qtyOf(lots);
}

export function seedUnexplainedShareFills(fills: InternalFill[], snapshots: ShareHoldingSnapshot[]): InternalFill[] {
  const earliest = new Map<string, ShareHoldingSnapshot>();
  for (const snap of snapshots) {
    const symbol = snap.symbol.trim().toUpperCase();
    const date = snap.date.slice(0, 10);
    if (!symbol || symbol === "CASH" || !/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
    if (!Number.isFinite(snap.quantity)) continue;
    const accountId = snap.accountId || "default";
    const key = `${accountId}|${symbol}`;
    const prev = earliest.get(key);
    if (prev && date > prev.date) continue;
    if (prev && date === prev.date) {
      prev.quantity += snap.quantity;
      if (!(prev.price != null && prev.price > 0) && snap.price != null && snap.price > 0) prev.price = snap.price;
      continue;
    }
    earliest.set(key, { accountId, symbol, date, quantity: snap.quantity, price: snap.price });
  }

  const seeds: InternalFill[] = [];
  for (const snap of earliest.values()) {
    const held = shareBookQty(fills, snap.accountId, snap.symbol, snap.date);
    const delta = snap.quantity - held;
    if (Math.abs(delta) < 1e-4) continue;
    if (!(snap.price != null && snap.price > 0)) continue;
    seeds.push({
      accountId: snap.accountId,
      date: snap.date,
      underlying: snap.symbol,
      leg: "share",
      signedShares: delta,
      price: snap.price,
      strike: null,
      expiration: null,
      seeded: true,
    });
  }
  if (seeds.length === 0) return fills;
  const seeded = new Set(seeds);
  return [...fills, ...seeds].sort((a, b) => {
    const byDate = a.date.localeCompare(b.date);
    if (byDate) return byDate;
    const bySeed = (seeded.has(a) ? 1 : 0) - (seeded.has(b) ? 1 : 0);
    if (bySeed) return bySeed;
    return a.accountId.localeCompare(b.accountId);
  });
}

type Px = { date: string; price: number; rank: number };

function roundPct(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function longCost(lots: Lot[]): number {
  return lots.reduce((sum, lot) => sum + (lot.qty > 0 ? lot.qty * lot.perUnit : 0), 0);
}

function unrealizedLots(lots: Lot[], mark: number | null): number {
  if (mark == null) return 0;
  let pnl = 0;
  for (const lot of lots) {
    if (lot.qty > 0) pnl += (mark - lot.perUnit) * lot.qty;
    else if (lot.qty < 0) pnl += (lot.perUnit - mark) * Math.abs(lot.qty);
  }
  return pnl;
}

function capitalFor(books: DayBooks, includeShares: boolean, includeSynthetic: boolean): number {
  let shareCost = 0;
  let putCollateral = 0;
  let longCallPremium = 0;
  for (const book of books.values()) {
    if (includeShares) shareCost += longCost(book.shareLots);
    if (!includeSynthetic) continue;
    const synthetic = syntheticQtyByContract(book.contracts);
    for (const [key, synQty] of synthetic) {
      const contract = book.contracts.get(key);
      if (!contract) continue;
      const open = qtyOf(contract.lots);
      if (Math.abs(open) < 1e-6) continue;
      if (contract.right === "P" && synQty < 0) putCollateral += contract.strike * Math.abs(synQty);
      if (contract.right === "C" && synQty > 0) longCallPremium += longCost(contract.lots) * Math.min(1, synQty / open);
    }
  }
  return shareCost + putCollateral + longCallPremium;
}

function pnlFor(
  books: DayBooks,
  shareRealized: number,
  syntheticRealized: number,
  includeShares: boolean,
  includeSynthetic: boolean,
  shareMark: number | null,
  optionMark: (contract: ContractBook) => number | null,
): { pnl: number; capital: number; unrealized: number; shareQty: number; syntheticAbs: number } {
  let unrealized = 0;
  let shareQty = 0;
  let syntheticAbs = 0;
  for (const book of books.values()) {
    shareQty += Math.max(0, bookShareQty(book));
    if (includeShares) unrealized += unrealizedLots(book.shareLots, shareMark);
    if (!includeSynthetic) continue;
    const synthetic = syntheticQtyByContract(book.contracts);
    for (const [key, synQty] of synthetic) {
      const contract = book.contracts.get(key);
      if (!contract) continue;
      const open = qtyOf(contract.lots);
      if (Math.abs(open) < 1e-6) continue;
      const fraction = Math.min(1, Math.abs(synQty) / Math.abs(open));
      syntheticAbs += Math.abs(synQty);
      unrealized += unrealizedLots(contract.lots, optionMark(contract)) * fraction;
    }
  }
  const pnl = (includeShares ? shareRealized : 0) + (includeSynthetic ? syntheticRealized : 0) + unrealized;
  return {
    pnl,
    capital: capitalFor(books, includeShares, includeSynthetic),
    unrealized,
    shareQty,
    syntheticAbs,
  };
}

function markOn(marks: SharePricePoint[], date: string): number | null {
  let price: number | null = null;
  let priceDate: string | null = null;
  for (const mark of marks) {
    if (mark.date > date) break;
    price = mark.price;
    priceDate = mark.date;
  }
  if (price == null || priceDate == null) return null;
  if ((daysBetween(priceDate, date) ?? STOCK_MARK_MAX_AGE_DAYS + 1) > STOCK_MARK_MAX_AGE_DAYS) return null;
  return price;
}

function roundMoney(value: number): number {
  return Math.round(value * 100) / 100;
}

function lotsMarked(lots: Lot[], basis: number): Lot[] {
  return lots.map((lot) => ({ qty: lot.qty, perUnit: basis }));
}

function shareCashAfter(
  fills: InternalFill[],
  symbol: string,
  afterDate: string,
  throughDate: string,
  startQty: Map<string, number>,
): number {
  const qty = new Map(startQty);
  let cash = 0;
  const ordered = fills
    .filter(
      (fill) =>
        !fill.seeded &&
        fill.leg === "share" &&
        fill.underlying === symbol &&
        fill.date > afterDate &&
        fill.date <= throughDate,
    )
    .sort((a, b) => a.date.localeCompare(b.date) || a.accountId.localeCompare(b.accountId));
  for (const fill of ordered) {
    const held = qty.get(fill.accountId) ?? 0;
    const applied = fill.signedShares < 0 ? -Math.min(-fill.signedShares, Math.max(0, held)) : fill.signedShares;
    if (Math.abs(applied) < 1e-9) continue;
    cash += applied * fill.price;
    qty.set(fill.accountId, held + applied);
  }
  return cash;
}

function shareQtyByAccount(books: DayBooks): Map<string, number> {
  const out = new Map<string, number>();
  for (const [accountId, book] of books) {
    const qty = Math.max(0, bookShareQty(book));
    if (qty > 1e-6) out.set(accountId, qty);
  }
  return out;
}

type LineValuation = {
  date: string;
  /** Signed economic value: shares at the mark plus signed option market value. */
  value: number | null;
  /** Denominator. Shares use value. Option lines use capital at risk. */
  base: number | null;
  /** Premium and share cash. Subtracted from the value change. */
  flow: number;
  /** Cash plus collateral posted or released. Weights the Dietz denominator. */
  capitalFlow: number;
  pnl: number;
  capital: number;
  shareEq: number;
  approx: boolean;
  openLegs: number;
  deltaLegs: number;
};

function signedSyntheticValue(books: DayBooks, markAt: (contract: ContractBook) => number | null): number {
  let value = 0;
  for (const book of books.values()) {
    const synthetic = syntheticQtyByContract(book.contracts);
    for (const [key, synQty] of synthetic) {
      const contract = book.contracts.get(key);
      if (!contract) continue;
      const mark = markAt(contract);
      if (mark == null) continue;
      value += synQty * mark;
    }
  }
  return value;
}

function optionFlowOnDate(fills: InternalFill[], books: DayBooks, date: string): number {
  let cash = 0;
  for (const fill of fills) {
    if (fill.seeded || fill.leg === "share" || fill.date !== date) continue;
    if (fill.strike == null || !fill.expiration) continue;
    const book = books.get(fill.accountId || "default");
    if (!book) continue;
    const right: "C" | "P" = fill.leg === "put" ? "P" : "C";
    const key = contractKey(right, fill.strike, fill.expiration);
    const contract = book.contracts.get(key);
    const open = contract ? qtyOf(contract.lots) : 0;
    const syn = contract ? (syntheticQtyByContract(book.contracts).get(key) ?? 0) : 0;
    const closingSynthetic =
      Math.abs(open) < 1e-6 &&
      ((fill.leg === "put" && fill.signedShares > 0) || (fill.leg === "call" && fill.signedShares < 0));
    if (Math.abs(syn) < 1e-6 && !closingSynthetic) continue;
    const fraction = Math.abs(open) > 1e-6 ? Math.min(1, Math.abs(syn) / Math.abs(open)) : 1;
    cash += fill.signedShares * fill.price * fraction;
  }
  return cash;
}

function shareFillMark(fills: InternalFill[], symbol: string, date: string): number | null {
  let cash = 0;
  let qty = 0;
  for (const fill of fills) {
    if (fill.seeded || fill.leg !== "share" || fill.underlying !== symbol || fill.date !== date) continue;
    cash += fill.signedShares * fill.price;
    qty += fill.signedShares;
  }
  if (!(Math.abs(qty) > 1e-9)) return null;
  const mark = cash / qty;
  return mark > 0 ? mark : null;
}

function normOcc(symbol: string | null | undefined): string {
  return (symbol ?? "").replace(/\s+/g, "").toUpperCase();
}

function deltaIndexes(points: OptionDeltaPoint[] | undefined): {
  byKey: Map<string, OptionDeltaPoint[]>;
  byOcc: Map<string, OptionDeltaPoint[]>;
} {
  const byKey = new Map<string, OptionDeltaPoint[]>();
  const byOcc = new Map<string, OptionDeltaPoint[]>();
  for (const point of points ?? []) {
    if (!Number.isFinite(point.delta)) continue;
    const occ = normOcc(point.occ);
    if (occ) {
      const listed = byOcc.get(occ) ?? [];
      listed.push(point);
      byOcc.set(occ, listed);
    }
    const underlying = point.underlying.trim().toUpperCase();
    if (!underlying) continue;
    const key = `${underlying}|${contractKey(point.right, point.strike, point.expiration)}`;
    const list = byKey.get(key) ?? [];
    list.push(point);
    byKey.set(key, list);
  }
  return { byKey, byOcc };
}

function nearestDelta(points: OptionDeltaPoint[], date: string): number | null {
  let best: { age: number; date: string; delta: number } | null = null;
  for (const point of points) {
    const age = daysBetween(point.date, date);
    if (age == null || age > STOCK_MARK_MAX_AGE_DAYS) continue;
    if (!best || age < best.age || (age === best.age && point.date >= best.date)) best = { age, date: point.date, delta: point.delta };
  }
  return best ? best.delta : null;
}

function optionShareEquivalent(
  books: DayBooks,
  symbol: string,
  date: string,
  spot: number | null,
  deltas: { byKey: Map<string, OptionDeltaPoint[]>; byOcc: Map<string, OptionDeltaPoint[]> },
): { eq: number; approx: boolean; openLegs: number; deltaLegs: number } {
  let eq = 0;
  let approx = false;
  let openLegs = 0;
  let deltaLegs = 0;
  for (const book of books.values()) {
    const synthetic = syntheticQtyByContract(book.contracts);
    for (const [key, synQty] of synthetic) {
      const contract = book.contracts.get(key);
      if (!contract) continue;
      openLegs += 1;
      const occ = normOcc(contract.occ);
      const points = (occ && deltas.byOcc.get(occ)) || deltas.byKey.get(`${symbol}|${key}`) || [];
      const stored = nearestDelta(points, date);
      if (stored != null) {
        deltaLegs += 1;
        eq += stored * synQty;
        continue;
      }
      approx = true;
      const deep =
        contract.right === "C" && synQty > 0 && spot != null && spot >= contract.strike * DEEP_ITM_MARK_OVER_STRIKE;
      if (deep) eq += synQty;
    }
  }
  return { eq, approx, openLegs, deltaLegs };
}

function putCollateral(books: DayBooks): number {
  let collateral = 0;
  for (const book of books.values()) {
    const synthetic = syntheticQtyByContract(book.contracts);
    for (const [key, synQty] of synthetic) {
      const contract = book.contracts.get(key);
      if (!contract || contract.right !== "P" || !(synQty < 0)) continue;
      collateral += contract.strike * Math.abs(synQty);
    }
  }
  return collateral;
}

function capitalAtRisk(
  books: DayBooks,
  shareQty: number,
  shareMark: number | null,
  markAt: (contract: ContractBook) => number | null,
): number {
  let base = shareMark != null && shareQty > 1e-6 ? shareQty * shareMark : 0;
  for (const book of books.values()) {
    const synthetic = syntheticQtyByContract(book.contracts);
    for (const [key, synQty] of synthetic) {
      const contract = book.contracts.get(key);
      if (!contract) continue;
      if (contract.right === "P" && synQty < 0) base += contract.strike * Math.abs(synQty);
      if (contract.right === "C" && synQty > 0) {
        const mark = markAt(contract);
        if (mark != null) {
          base += mark * synQty;
          continue;
        }
        const open = Math.abs(qtyOf(contract.lots));
        const fraction = open > 1e-6 ? Math.min(1, synQty / open) : 1;
        base += longCost(contract.lots) * fraction;
      }
    }
  }
  return base;
}

function addIsoDays(iso: string, days: number): string {
  const [y, m, d] = iso.split("-").map(Number);
  const dt = new Date(Date.UTC(y ?? 1970, (m ?? 1) - 1, d ?? 1));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

function averageShareEquivalents(rows: LineValuation[], from: string, to: string): number {
  const span = (daysBetween(from, to) ?? 0) + 1;
  if (span <= 0) return 0;
  const ordered = rows.filter((row) => row.date <= to).sort((a, b) => a.date.localeCompare(b.date));
  let sum = 0;
  let cursor = from;
  for (let i = 0; i < span; i++) {
    let eq = 0;
    for (const row of ordered) {
      if (row.date > cursor) break;
      eq = row.shareEq;
    }
    sum += eq;
    cursor = addIsoDays(cursor, 1);
  }
  return sum / span;
}

function valuationAt(rows: LineValuation[], through: string): LineValuation | null {
  let found: LineValuation | null = null;
  for (const row of rows) {
    if (row.date > through) break;
    found = row;
  }
  return found;
}

function chainedTwr(rows: LineValuation[], through: string, floorLoss: boolean): number | null {
  let growth = 1;
  let pending = 0;
  let prevValue: number | null = null;
  let prevBase: number | null = null;
  let linked = false;
  for (const row of rows) {
    if (row.date > through) break;
    if (row.value == null || row.base == null) {
      pending += row.flow;
      continue;
    }
    if (prevValue == null || prevBase == null) {
      prevValue = row.value;
      prevBase = row.base;
      continue;
    }
    const flow = row.flow + pending;
    pending = 0;
    if (prevBase > TINY_DENOMINATOR) {
      let sub = (row.value - prevValue - flow) / prevBase;
      if (floorLoss) sub = Math.max(-1, sub);
      growth *= 1 + sub;
      linked = true;
    }
    prevValue = row.value;
    prevBase = row.base;
  }
  if (!(linked || prevValue != null)) return null;
  const pct = (growth - 1) * 100;
  return roundPct(floorLoss ? Math.max(-100, pct) : pct);
}

function modifiedDietz(
  rows: LineValuation[],
  through: string,
): { pnl: number; denominator: number; fallback: boolean } {
  const at = valuationAt(rows, through);
  const start = rows.find((row) => row.value != null && row.base != null && row.date <= through);
  let end: LineValuation | null = null;
  for (const row of rows) {
    if (row.date > through) break;
    if (row.value != null) end = row;
  }
  const capitalPnl = at?.pnl ?? 0;
  const capital = at?.capital ?? 0;
  if (!start || !end || start.value == null || end.value == null || start.base == null) {
    return { pnl: capitalPnl, denominator: capital, fallback: true };
  }
  const span = daysBetween(start.date, end.date) ?? 0;
  let weighted = 0;
  for (const row of rows) {
    if (row.date <= start.date || row.date > end.date) continue;
    if (Math.abs(row.capitalFlow) < 1e-9) continue;
    const elapsed = daysBetween(start.date, row.date) ?? 0;
    const weight = span > 0 ? (span - elapsed) / span : 0;
    weighted += row.capitalFlow * weight;
  }
  const denominator = start.base + weighted;
  if (!(denominator > TINY_DENOMINATOR)) return { pnl: capitalPnl, denominator: capital, fallback: true };
  return { pnl: capitalPnl, denominator, fallback: false };
}

export function buildInternalPerformanceSeries(
  fills: InternalFill[],
  opts: {
    asOf: string;
    dates: string[];
    sharePrices?: Record<string, SharePricePoint[]>;
    optionMarks?: OptionMarkPoint[];
    optionDeltas?: OptionDeltaPoint[];
    openHoldings?: OpenHolding[];
    shareSnapshots?: ShareSnapshotRow[];
    method?: InternalReturnMethod;
  },
): { symbols: QualifiedUnderlying[]; bySymbol: Record<string, InternalSeriesPoint[]>; audit: InternalAudit[] } {
  const method = opts.method ?? "capital";
  const dates = [...opts.dates].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  if (dates.length === 0) return { symbols: [], bySymbol: {}, audit: [] };
  const window = { start: dates[0]!, end: dates[dates.length - 1]! };
  const asOf = opts.asOf > window.end ? opts.asOf : window.end;
  const qualified = qualifyInternalUnderlyings(fills, asOf, window, opts.openHoldings);
  const grouped = groupFills(fills);
  const bySymbol: Record<string, InternalSeriesPoint[]> = {};
  const audit: InternalAudit[] = [];

  for (const { symbol, reason } of qualified) {
    const symbolFills = grouped.get(symbol) ?? [];
    const includeShares = reason === "shares" || reason === "both";
    const includeSynthetic = reason === "synthetic" || reason === "both";
    const visit = visitDates(
      symbolFills.map((fill) => fill.date),
      dates,
      window.end,
    );
    const snaps = replaySymbol(symbolFills, visit);
    const shareMarks = [...(opts.sharePrices?.[symbol] ?? [])].sort((a, b) => a.date.localeCompare(b.date));
    const chartStartPrice = markOn(shareMarks, dates[0]!);
    const optionPoints = new Map<string, Px[]>();
    const pushOption = (point: OptionMarkPoint, rank: number) => {
      if (point.underlying.trim().toUpperCase() !== symbol) return;
      const key = contractKey(point.right, point.strike, point.expiration);
      const list = optionPoints.get(key) ?? [];
      list.push({ date: point.date, price: point.price, rank });
      optionPoints.set(key, list);
    };
    for (const fill of symbolFills) {
      if (fill.leg === "share" || fill.strike == null || !fill.expiration) continue;
      pushOption(
        {
          underlying: symbol,
          right: fill.leg === "put" ? "P" : "C",
          strike: fill.strike,
          expiration: fill.expiration,
          date: fill.date,
          price: fill.price,
        },
        0,
      );
    }
    for (const mark of opts.optionMarks ?? []) pushOption(mark, 1);
    for (const list of optionPoints.values()) list.sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank);

    const collapsedSnaps = latestShareSnapshotsByDay(
      (opts.shareSnapshots ?? []).filter((row) => row.symbol.trim().toUpperCase() === symbol),
    );
    const optionMarkAt = (contract: ContractBook, date: string): number | null =>
      markOn(
        (optionPoints.get(contractKey(contract.right, contract.strike, contract.expiration)) ?? []).map((point) => ({
          date: point.date,
          price: point.price,
        })),
        date,
      );
    const optionUnrealizedAt = (books: DayBooks, date: string, basisDate: string): number => {
      if (!includeSynthetic) return 0;
      let pnl = 0;
      for (const book of books.values()) {
        const synthetic = syntheticQtyByContract(book.contracts);
        for (const [key, synQty] of synthetic) {
          const contract = book.contracts.get(key);
          if (!contract) continue;
          const open = qtyOf(contract.lots);
          if (Math.abs(open) < 1e-6) continue;
          const basis = optionMarkAt(contract, basisDate);
          const mark = optionMarkAt(contract, date);
          if (basis == null || mark == null) continue;
          const fraction = Math.min(1, Math.abs(synQty) / Math.abs(open));
          pnl += unrealizedLots(lotsMarked(contract.lots, basis), mark) * fraction;
        }
      }
      return pnl;
    };

    const chartDates = new Set(dates);
    const deltas = deltaIndexes(opts.optionDeltas);
    let baselineDate: string | null = null;
    let shareQty0 = 0;
    let shareMark0: number | null = null;
    let underlyingMark0: number | null = null;
    let optionRealized0 = 0;
    let syntheticCapital0 = 0;
    let startQtyByAccount = new Map<string, number>();
    let maxCapital = 0;
    let prevShareCash = 0;
    let prevPutCollateral = 0;
    let sawValuation = false;
    let lastAudit: InternalAudit | null = null;
    let auditDate: string | null = null;
    const valuations: LineValuation[] = [];
    const pointByDate = new Map<string, InternalSeriesPoint>();
    const lineValue = (books: DayBooks, shareQty: number, shareMark: number | null, date: string): number | null => {
      const optionValue = includeSynthetic ? signedSyntheticValue(books, (contract) => optionMarkAt(contract, date)) : 0;
      if (shareQty > 1e-6) {
        const link = shareMark ?? shareFillMark(symbolFills, symbol, date);
        return link != null ? shareQty * link + optionValue : null;
      }
      return optionValue;
    };
    const remember = (date: string, books: DayBooks, shareQty: number, shareMark: number | null, flow: number, pnl: number) => {
      const spot = shareMark ?? underlyingMark0;
      const optionEq = includeSynthetic
        ? optionShareEquivalent(books, symbol, date, spot, deltas)
        : { eq: 0, approx: false, openLegs: 0, deltaLegs: 0 };
      const value = lineValue(books, shareQty, shareMark, date);
      const linedShares = includeShares ? shareQty : 0;
      const base = includeSynthetic ? capitalAtRisk(books, linedShares, shareMark, (contract) => optionMarkAt(contract, date)) : value;
      const collateral = includeSynthetic ? putCollateral(books) : 0;
      const collateralDelta = sawValuation ? collateral - prevPutCollateral : 0;
      sawValuation = true;
      prevPutCollateral = collateral;
      valuations.push({
        date,
        value,
        base,
        flow,
        capitalFlow: includeSynthetic ? flow + collateralDelta : flow,
        pnl,
        capital: maxCapital,
        shareEq: linedShares + optionEq.eq,
        approx: optionEq.approx,
        openLegs: optionEq.openLegs,
        deltaLegs: optionEq.deltaLegs,
      });
    };
    for (const snap of snaps) {
      const shareMark = markOn(shareMarks, snap.date);
      const valued = pnlFor(
        snap.books,
        snap.shareRealized,
        snap.syntheticRealized,
        includeShares,
        includeSynthetic,
        shareMark,
        (contract) => optionMarkAt(contract, snap.date),
      );
      const snappedByAccount = includeShares ? snapshotShareQtyByAccount(collapsedSnaps, symbol, snap.date, symbolFills) : null;
      const snappedQty = snappedByAccount ? [...snappedByAccount.values()].reduce((sum, qty) => sum + qty, 0) : null;
      const shareQty = snappedQty ?? valued.shareQty;
      const shareActive = includeShares && shareQty > 1e-6;
      const syntheticActive = includeSynthetic && (valued.syntheticAbs > 1e-6 || snap.syntheticRealized !== 0);
      const active = shareActive || syntheticActive;
      if (!chartDates.has(snap.date) && baselineDate == null) continue;
      if (baselineDate == null) {
        if (!active || (shareActive && shareMark == null && !syntheticActive)) {
          if (chartDates.has(snap.date)) pointByDate.set(snap.date, { date: snap.date, returnPct: null, stockPct: null });
          continue;
        }
        baselineDate = snap.date;
        shareQty0 = shareQty;
        shareMark0 = shareActive ? shareMark : null;
        underlyingMark0 = shareMark;
        optionRealized0 = includeSynthetic ? snap.syntheticRealized : 0;
        syntheticCapital0 = includeSynthetic ? capitalFor(snap.books, false, true) : 0;
        startQtyByAccount = new Map();
        if (snappedByAccount) {
          for (const [accountId, qty] of snappedByAccount) if (qty > 1e-6) startQtyByAccount.set(accountId, qty);
        } else {
          startQtyByAccount = shareQtyByAccount(snap.books);
        }
        const shareCapital = shareMark0 != null && shareQty0 > 1e-6 ? shareQty0 * shareMark0 : includeShares ? valued.capital - syntheticCapital0 : 0;
        maxCapital = Math.max(0, shareCapital) + syntheticCapital0;
        remember(snap.date, snap.books, shareQty, shareMark, 0, 0);
        if (chartDates.has(snap.date)) {
          const stockPct = chartStartPrice != null && chartStartPrice > 0 && shareMark != null ? roundPct((shareMark / chartStartPrice - 1) * 100) : null;
          pointByDate.set(snap.date, {
            date: snap.date,
            returnPct: maxCapital > 0 ? 0 : null,
            stockPct,
          });
          auditDate = snap.date;
          lastAudit = {
            symbol,
            method: "capital",
            pnl: 0,
            denominator: roundMoney(maxCapital),
            capital: roundMoney(maxCapital),
            returnPct: maxCapital > 0 ? 0 : null,
            stockPct,
            fallback: false,
            approx: false,
            unpriced: false,
            openLegs: valuations[valuations.length - 1]?.openLegs ?? 0,
            deltaLegs: valuations[valuations.length - 1]?.deltaLegs ?? 0,
          };
        }
        continue;
      }
      const cash = includeShares ? shareCashAfter(symbolFills, symbol, baselineDate, snap.date, startQtyByAccount) : 0;
      const sharePnl =
        includeShares && shareMark0 != null && shareMark != null ? shareQty * shareMark - shareQty0 * shareMark0 - cash : 0;
      const optionPnl = includeSynthetic
        ? snap.syntheticRealized - optionRealized0 + optionUnrealizedAt(snap.books, snap.date, baselineDate)
        : 0;
      const syntheticCapital = includeSynthetic ? capitalFor(snap.books, false, true) : 0;
      maxCapital = Math.max(maxCapital, Math.max(0, (shareMark0 != null ? shareQty0 * shareMark0 : 0) + cash) + syntheticCapital);
      const pnl = sharePnl + optionPnl;
      const shareFlow = cash - prevShareCash;
      prevShareCash = cash;
      const flow = shareFlow + (includeSynthetic ? optionFlowOnDate(symbolFills, snap.books, snap.date) : 0);
      remember(snap.date, snap.books, shareQty, shareMark, flow, pnl);
      if (!chartDates.has(snap.date)) continue;
      const returnPct = maxCapital > 0 ? roundPct((pnl / maxCapital) * 100) : null;
      const stockPct =
        chartStartPrice != null && chartStartPrice > 0 && shareMark != null ? roundPct((shareMark / chartStartPrice - 1) * 100) : null;
      pointByDate.set(snap.date, { date: snap.date, returnPct, stockPct });
      auditDate = snap.date;
      lastAudit = {
        symbol,
        method: "capital",
        pnl: roundMoney(pnl),
        denominator: roundMoney(maxCapital),
        capital: roundMoney(maxCapital),
        returnPct,
        stockPct,
        fallback: false,
        approx: false,
        unpriced: false,
        openLegs: valuations[valuations.length - 1]?.openLegs ?? 0,
        deltaLegs: valuations[valuations.length - 1]?.deltaLegs ?? 0,
      };
    }
    if (method !== "capital" && baselineDate && auditDate && lastAudit) {
      const apply = (through: string) => {
        const at = valuationAt(valuations, through);
        const capitalPnl = at?.pnl ?? 0;
        const capitalBase = at?.capital ?? 0;
        const bound = (pct: number | null) => (includeSynthetic && pct != null ? Math.max(-100, pct) : pct);
        if (method === "twr") {
          const start = valuations.find((row) => row.base != null && row.date <= through);
          return {
            pnl: capitalPnl,
            denominator: start?.base ?? capitalBase,
            returnPct: chainedTwr(valuations, through, includeSynthetic),
            fallback: false,
            approx: false,
            unpriced: false,
          };
        }
        if (method === "dietz") {
          const dietz = modifiedDietz(valuations, through);
          const raw = dietz.denominator > TINY_DENOMINATOR ? roundPct((dietz.pnl / dietz.denominator) * 100) : null;
          return { pnl: dietz.pnl, denominator: dietz.denominator, returnPct: bound(raw), fallback: dietz.fallback, approx: false, unpriced: false };
        }
        const approx = at?.approx ?? false;
        const spot = markOn(shareMarks, through);
        if (spot == null || underlyingMark0 == null || !(underlyingMark0 > 0)) {
          return { pnl: capitalPnl, denominator: 0, returnPct: null, fallback: false, approx, unpriced: true };
        }
        const denom = averageShareEquivalents(valuations, baselineDate, through) * underlyingMark0;
        const raw = denom > TINY_DENOMINATOR ? roundPct((capitalPnl / denom) * 100) : null;
        return { pnl: capitalPnl, denominator: denom, returnPct: bound(raw), fallback: false, approx, unpriced: false };
      };
      for (const date of dates) {
        if (date < baselineDate) continue;
        const existing = pointByDate.get(date);
        if (!existing || existing.returnPct == null) continue;
        pointByDate.set(date, { ...existing, returnPct: apply(date).returnPct });
      }
      const end = apply(auditDate);
      const endLegs = valuationAt(valuations, auditDate);
      lastAudit = {
        ...lastAudit,
        method,
        pnl: roundMoney(end.pnl),
        denominator: roundMoney(end.denominator),
        returnPct: end.returnPct,
        fallback: end.fallback,
        approx: end.approx,
        unpriced: end.unpriced,
        openLegs: endLegs?.openLegs ?? 0,
        deltaLegs: endLegs?.deltaLegs ?? 0,
      };
    }
    if (lastAudit) audit.push(lastAudit);
    const points = dates.map((date) => pointByDate.get(date) ?? { date, returnPct: null, stockPct: null });
    if (points.some((point) => point.returnPct != null) || lastAudit?.unpriced) bySymbol[symbol] = points;
  }

  audit.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return {
    symbols: qualified.filter((row) => bySymbol[row.symbol]),
    bySymbol,
    audit,
  };
}

function signedFromKind(kind: ReturnType<typeof inferInstructionKind>, quantity: number, multiplier: number): number | null {
  const magnitude = Math.abs(quantity) * multiplier;
  if (!(magnitude > 0)) return null;
  if (kind === "buy_open" || kind === "buy_close") return magnitude;
  if (kind === "sell_open" || kind === "sell_close") return -magnitude;
  return null;
}

function legQuantity(leg: { quantity?: number | null; amount?: number | null }): number | null {
  if (typeof leg.quantity === "number" && Number.isFinite(leg.quantity)) return leg.quantity;
  if (typeof leg.amount === "number" && Number.isFinite(leg.amount)) return leg.amount;
  return null;
}

function signedShareEquivalents(
  instruction: string | null | undefined,
  positionEffect: string | null | undefined,
  quantity: number,
  multiplier: number,
): number | null {
  const kind = inferInstructionKind({ instruction, positionEffect, quantity });
  return signedFromKind(kind, quantity, multiplier);
}

function fillFromSchwabLeg(accountId: string, date: string, leg: SchwabTxnItem): InternalFill | null {
  const asset = (leg.instrument?.assetType ?? "").toUpperCase();
  const symbol = leg.instrument?.symbol?.trim() || "";
  const parsed = parseOptionFromSchwabSymbol(symbol);
  const putCall = (leg.instrument?.putCall ?? "").toUpperCase();
  const right = parsed?.right ?? (putCall.startsWith("P") ? "P" : putCall.startsWith("C") ? "C" : null);
  const isOption = asset === "OPTION" || right != null;
  const qty = legQuantity(leg);
  const price = typeof leg.price === "number" ? leg.price : null;
  if (qty == null || price == null || !(price > 0)) return null;
  const signed = signedShareEquivalents(leg.instruction ?? null, leg.positionEffect ?? null, qty, isOption ? CONTRACT_SHARES : 1);
  if (signed == null) return null;
  if (!isOption) {
    const underlying = (leg.instrument?.underlyingSymbol || symbol).trim().toUpperCase();
    if (!underlying) return null;
    return {
      accountId,
      date,
      underlying,
      leg: "share",
      signedShares: signed,
      price,
      strike: null,
      expiration: null,
    };
  }
  const underlying = (leg.instrument?.underlyingSymbol || parsed?.underlying || "").trim().toUpperCase();
  const expiration = parsed?.expiration ?? null;
  const strike = parsed?.strike ?? (typeof leg.instrument?.strikePrice === "number" ? leg.instrument.strikePrice : null);
  if (!underlying || !expiration || strike == null || right == null) return null;
  return {
    accountId,
    date,
    underlying,
    leg: right === "P" ? "put" : "call",
    signedShares: signed,
    price,
    strike,
    expiration,
    occ: leg.instrument?.symbol,
  };
}

function fillFromColumns(row: StoredBrokerFillRow, date: string): InternalFill | null {
  const rightRaw = (row.option_right ?? "").toUpperCase();
  const right = rightRaw.startsWith("P") ? "P" : rightRaw.startsWith("C") ? "C" : null;
  const asset = (row.asset_type ?? "").toUpperCase();
  const isOption = asset === "OPTION" || right != null;
  const qty = row.quantity;
  const price = row.price;
  if (qty == null || price == null || !(price > 0)) return null;
  const signed = signedShareEquivalents(row.instruction, row.position_effect, qty, isOption ? CONTRACT_SHARES : 1);
  if (signed == null) return null;
  if (!isOption) {
    const underlying = (row.underlying_symbol || row.symbol || "").trim().toUpperCase();
    if (!underlying) return null;
    return {
      accountId: row.account_id,
      date,
      underlying,
      leg: "share",
      signedShares: signed,
      price,
      strike: null,
      expiration: null,
    };
  }
  const underlying = (row.underlying_symbol || "").trim().toUpperCase();
  if (!underlying || !row.option_expiration || row.option_strike == null || right == null) return null;
  return {
    accountId: row.account_id,
    date,
    underlying,
    leg: right === "P" ? "put" : "call",
    signedShares: signed,
    price,
    strike: row.option_strike,
    expiration: row.option_expiration.slice(0, 10),
    occ: row.symbol ?? undefined,
  };
}

export function internalFillsFromStoredRow(row: StoredBrokerFillRow): InternalFill[] {
  const type = (row.transaction_type ?? "TRADE").toUpperCase();
  if (type !== "TRADE") return [];
  const date = row.trade_date.slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return [];
  if (row.raw_json) {
    try {
      const raw = JSON.parse(row.raw_json) as SchwabTxnRaw;
      const legs = securityLegsOf(raw);
      if (legs.length > 0) {
        return legs
          .map((leg) => fillFromSchwabLeg(row.account_id, date, leg))
          .filter((fill): fill is InternalFill => fill != null);
      }
    } catch {
    }
  }
  const one = fillFromColumns(row, date);
  return one ? [one] : [];
}
