import { daysBetween, instructionKind, parseOptionFromSchwabSymbol } from "@/lib/strategy/optionParse";
import { isButterflyStructure, type OptionLegView } from "@/lib/strategy/optionStructures";
import { fifoRealizedForClosingLeg } from "@/lib/analytics/periodReport";
import { isNyTradingDayYmd } from "@/lib/analytics/periodWindows";
import { securityLegsOf, type SchwabTxnItem, type SchwabTxnRaw } from "@/lib/schwab/transactionNormalize";

const SYNTHETIC_SPAN_MUST_EXCEED_DAYS = 180;
const FLAT_GAP_TRADING_DAYS = 5;
const CONTRACT_SHARES = 100;

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
};

export type QualifyReason = "shares" | "synthetic" | "both";

export type QualifiedUnderlying = {
  symbol: string;
  reason: QualifyReason;
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
  if (existing) return existing;
  const created: ContractBook = { right, strike, expiration, lots: [] };
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
): QualifiedUnderlying[] {
  const grouped = groupFills(fills);
  const out: QualifiedUnderlying[] = [];
  for (const [symbol, symbolFills] of grouped) {
    const reason = classifySymbol(symbolFills, asOf, window);
    if (reason) out.push({ symbol, reason });
  }
  out.sort((a, b) => a.symbol.localeCompare(b.symbol));
  return out;
}

type Px = { date: string; price: number; rank: number };

function roundPct(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

function lastPrice(points: Px[], date: string): number | null {
  let price: number | null = null;
  for (const point of points) {
    if (point.date > date) break;
    price = point.price;
  }
  return price;
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
): { pnl: number; capital: number; shareQty: number; syntheticAbs: number } {
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
    shareQty,
    syntheticAbs,
  };
}

export function buildInternalPerformanceSeries(
  fills: InternalFill[],
  opts: {
    asOf: string;
    dates: string[];
    sharePrices?: Record<string, SharePricePoint[]>;
    optionMarks?: OptionMarkPoint[];
  },
): { symbols: QualifiedUnderlying[]; bySymbol: Record<string, InternalSeriesPoint[]> } {
  const dates = [...opts.dates].filter((date) => /^\d{4}-\d{2}-\d{2}$/.test(date)).sort();
  if (dates.length === 0) return { symbols: [], bySymbol: {} };
  const window = { start: dates[0]!, end: dates[dates.length - 1]! };
  const asOf = opts.asOf > window.end ? opts.asOf : window.end;
  const qualified = qualifyInternalUnderlyings(fills, asOf, window);
  const grouped = groupFills(fills);
  const bySymbol: Record<string, InternalSeriesPoint[]> = {};

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
    const sharePoints: Px[] = [
      ...symbolFills
        .filter((fill) => fill.leg === "share")
        .map((fill) => ({ date: fill.date, price: fill.price, rank: 0 })),
      ...(opts.sharePrices?.[symbol] ?? []).map((point) => ({ date: point.date, price: point.price, rank: 1 })),
    ].sort((a, b) => a.date.localeCompare(b.date) || a.rank - b.rank);
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

    const chartDates = new Set(dates);
    let baselinePnl: number | null = null;
    let maxCapital = 0;
    let baselinePrice: number | null = null;
    const pointByDate = new Map<string, InternalSeriesPoint>();
    for (const snap of snaps) {
      const valued = pnlFor(
        snap.books,
        snap.shareRealized,
        snap.syntheticRealized,
        includeShares,
        includeSynthetic,
        lastPrice(sharePoints, snap.date),
        (contract) =>
          lastPrice(optionPoints.get(contractKey(contract.right, contract.strike, contract.expiration)) ?? [], snap.date),
      );
      const shareActive = includeShares && (valued.shareQty > 1e-6 || snap.shareRealized !== 0);
      const syntheticActive = includeSynthetic && (valued.syntheticAbs > 1e-6 || snap.syntheticRealized !== 0);
      const active = shareActive || syntheticActive || valued.capital > 1e-6;
      if (!chartDates.has(snap.date) && baselinePnl == null) continue;
      if (baselinePnl == null) {
        if (!active) {
          if (chartDates.has(snap.date)) pointByDate.set(snap.date, { date: snap.date, returnPct: null, stockPct: null });
          continue;
        }
        baselinePnl = valued.pnl;
        maxCapital = valued.capital;
        baselinePrice = lastPrice(sharePoints, snap.date);
        if (chartDates.has(snap.date)) {
          pointByDate.set(snap.date, {
            date: snap.date,
            returnPct: maxCapital > 0 ? 0 : null,
            stockPct: baselinePrice != null && baselinePrice > 0 ? 0 : null,
          });
        }
        continue;
      }
      maxCapital = Math.max(maxCapital, valued.capital);
      if (!chartDates.has(snap.date)) continue;
      const stock = lastPrice(sharePoints, snap.date);
      pointByDate.set(snap.date, {
        date: snap.date,
        returnPct: maxCapital > 0 ? roundPct(((valued.pnl - baselinePnl) / maxCapital) * 100) : null,
        stockPct: baselinePrice != null && baselinePrice > 0 && stock != null ? roundPct((stock / baselinePrice - 1) * 100) : null,
      });
    }
    const points = dates.map((date) => pointByDate.get(date) ?? { date, returnPct: null, stockPct: null });
    if (points.some((point) => point.returnPct != null)) bySymbol[symbol] = points;
  }

  return {
    symbols: qualified.filter((row) => bySymbol[row.symbol]),
    bySymbol,
  };
}

function signedFromKind(kind: ReturnType<typeof instructionKind>, quantity: number, multiplier: number): number | null {
  const magnitude = Math.abs(quantity) * multiplier;
  if (!(magnitude > 0)) return null;
  if (kind === "buy_open" || kind === "buy_close") return magnitude;
  if (kind === "sell_open" || kind === "sell_close") return -magnitude;
  return null;
}

function fillFromSchwabLeg(accountId: string, date: string, leg: SchwabTxnItem): InternalFill | null {
  const kind = instructionKind(leg.instruction ?? null);
  const asset = (leg.instrument?.assetType ?? "").toUpperCase();
  const symbol = leg.instrument?.symbol?.trim() || "";
  const parsed = parseOptionFromSchwabSymbol(symbol);
  const putCall = (leg.instrument?.putCall ?? "").toUpperCase();
  const right = parsed?.right ?? (putCall.startsWith("P") ? "P" : putCall.startsWith("C") ? "C" : null);
  const isOption = asset === "OPTION" || right != null;
  const qty = typeof leg.quantity === "number" ? leg.quantity : typeof leg.amount === "number" ? leg.amount : null;
  const price = typeof leg.price === "number" ? leg.price : null;
  if (qty == null || price == null || !(price > 0)) return null;
  const signed = signedFromKind(kind, qty, isOption ? CONTRACT_SHARES : 1);
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
  };
}

function fillFromColumns(row: StoredBrokerFillRow, date: string): InternalFill | null {
  const kind = instructionKind(row.instruction);
  const rightRaw = (row.option_right ?? "").toUpperCase();
  const right = rightRaw.startsWith("P") ? "P" : rightRaw.startsWith("C") ? "C" : null;
  const asset = (row.asset_type ?? "").toUpperCase();
  const isOption = asset === "OPTION" || right != null;
  const qty = row.quantity;
  const price = row.price;
  if (qty == null || price == null || !(price > 0)) return null;
  const signed = signedFromKind(kind, qty, isOption ? CONTRACT_SHARES : 1);
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
