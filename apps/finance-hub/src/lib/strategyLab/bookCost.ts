import { isoDate, type IsoDate, type OptionRight } from "@/lib/optionChain/chain";
import { resolvePositionAveragePrice } from "@/lib/holdings/positionAveragePrice";
import { parseOptionFromSchwabSymbol } from "@/lib/strategy/optionParse";

export type BookPositionInput = {
  readonly id: string;
  readonly accountId: string;
  readonly accountLabel: string;
  readonly symbol: string | null;
  readonly securityType: string;
  readonly underlyingSymbol: string | null;
  readonly optionType: string | null;
  readonly expirationDate: string | null;
  readonly strikePrice: number | null;
  readonly quantity: number;
  readonly price: number | null;
  readonly marketValue: number | null;
  readonly metadataJson: string | null;
};

export type BookTxnInput = {
  readonly accountId: string;
  readonly tradeDate: string;
  readonly symbol: string | null;
  readonly underlyingSymbol: string | null;
  readonly assetType: string | null;
  readonly instruction: string | null;
  readonly positionEffect: string | null;
  readonly quantity: number | null;
  readonly price: number | null;
  readonly optionExpiration: string | null;
  readonly optionRight: string | null;
  readonly optionStrike: number | null;
};

export type BookInstrument = "call" | "put" | "stock";
export type BookCostSource = "transactions" | "position" | "missing";

export type BookLeg = {
  readonly id: string;
  readonly accountId: string;
  readonly accountLabel: string;
  readonly underlying: string;
  readonly instrument: BookInstrument;
  readonly expiry: IsoDate | null;
  readonly right: OptionRight | null;
  readonly strike: number | null;
  readonly quantity: number;
  readonly bookPrice: number | null;
  readonly bookDate: IsoDate | null;
  readonly mark: number | null;
  readonly costSource: BookCostSource;
  readonly dateSource: BookCostSource;
  readonly fillCount: number;
  readonly partial: boolean;
  readonly missingCost: boolean;
};

type LotKey = {
  readonly accountId: string;
  readonly underlying: string;
  readonly instrument: BookInstrument;
  readonly expiry: string | null;
  readonly right: OptionRight | null;
  readonly strike: number | null;
};

type Lot = { readonly date: IsoDate; qty: number; readonly price: number };

type Side = "long" | "short";

function asDate(value: string | null | undefined): IsoDate | null {
  if (!value) return null;
  const text = value.slice(0, 10);
  try {
    return isoDate(text);
  } catch {
    return null;
  }
}

function rightOf(optionType: string | null, parsed: OptionRight | null): OptionRight | null {
  const text = (optionType ?? "").toUpperCase();
  if (text === "C" || text === "CALL") return "C";
  if (text === "P" || text === "PUT") return "P";
  return parsed;
}

function purchaseDateOf(metadataJson: string | null): IsoDate | null {
  if (!metadataJson) return null;
  try {
    const meta = JSON.parse(metadataJson) as { purchaseDate?: unknown };
    return typeof meta.purchaseDate === "string" ? asDate(meta.purchaseDate) : null;
  } catch {
    return null;
  }
}

function markOf(instrument: BookInstrument, quantity: number, price: number | null, marketValue: number | null): number | null {
  const multiplier = instrument === "stock" ? 1 : 100;
  if (marketValue != null && quantity !== 0) {
    const per = marketValue / quantity / multiplier;
    if (Number.isFinite(per) && per !== 0) return Math.abs(per);
  }
  if (price != null && Number.isFinite(price) && price > 0) return price;
  return null;
}

function lotKey(parts: LotKey): string {
  const strike = parts.strike == null ? "" : String(Math.round(parts.strike * 1000));
  return [parts.accountId, parts.underlying, parts.instrument, parts.expiry ?? "", parts.right ?? "", strike].join("|");
}

function classify(instruction: string | null, positionEffect: string | null, longQty: number, shortQty: number): { side: Side; open: boolean } | null {
  const inst = (instruction ?? "").toUpperCase().replace(/\s+/g, "_");
  const effect = (positionEffect ?? "").toUpperCase();
  const buy = inst.startsWith("BUY");
  const sell = inst.startsWith("SELL");
  if (inst.includes("BUY_TO_OPEN") || (effect === "OPENING" && buy)) return { side: "long", open: true };
  if (inst.includes("SELL_TO_OPEN") || (effect === "OPENING" && sell)) return { side: "short", open: true };
  if (inst.includes("SELL_TO_CLOSE") || (effect === "CLOSING" && sell)) return { side: "long", open: false };
  if (inst.includes("BUY_TO_CLOSE") || (effect === "CLOSING" && buy)) return { side: "short", open: false };
  if (buy && !sell) {
    if (shortQty > 1e-9 && longQty <= 1e-9) return { side: "short", open: false };
    return { side: "long", open: true };
  }
  if (sell && !buy) {
    if (longQty > 1e-9) return { side: "long", open: false };
    return { side: "short", open: true };
  }
  return null;
}

function consume(lots: Lot[], qty: number) {
  let left = qty;
  while (left > 1e-9 && lots.length > 0) {
    const lot = lots[0]!;
    const take = Math.min(lot.qty, left);
    lot.qty -= take;
    left -= take;
    if (lot.qty <= 1e-9) lots.shift();
  }
}

type Remaining = { readonly qty: number; readonly price: number; readonly date: IsoDate; readonly fills: number };

function remainingOf(lots: readonly Lot[]): Remaining | null {
  const open = lots.filter((lot) => lot.qty > 1e-9);
  if (open.length === 0) return null;
  const qty = open.reduce((sum, lot) => sum + lot.qty, 0);
  const price = open.reduce((sum, lot) => sum + lot.qty * lot.price, 0) / qty;
  const date = open.reduce((earliest, lot) => (lot.date < earliest ? lot.date : earliest), open[0]!.date);
  return { qty, price, date, fills: open.length };
}

type TxnLot = LotKey & { readonly tradeDate: IsoDate; readonly quantity: number; readonly price: number; readonly instruction: string | null; readonly positionEffect: string | null };

function rebuildLots(txns: readonly TxnLot[]): Map<string, { long: Remaining | null; short: Remaining | null }> {
  const grouped = new Map<string, TxnLot[]>();
  for (const txn of txns) {
    const key = lotKey(txn);
    const list = grouped.get(key);
    if (list) list.push(txn);
    else grouped.set(key, [txn]);
  }
  const out = new Map<string, { long: Remaining | null; short: Remaining | null }>();
  for (const [key, rows] of grouped) {
    const ordered = [...rows].sort((a, b) => (a.tradeDate < b.tradeDate ? -1 : a.tradeDate > b.tradeDate ? 1 : 0));
    const longLots: Lot[] = [];
    const shortLots: Lot[] = [];
    for (const row of ordered) {
      if (!(row.quantity > 0) || !(row.price > 0)) continue;
      const longQty = longLots.reduce((sum, lot) => sum + lot.qty, 0);
      const shortQty = shortLots.reduce((sum, lot) => sum + lot.qty, 0);
      const action = classify(row.instruction, row.positionEffect, longQty, shortQty);
      if (!action) continue;
      const book = action.side === "long" ? longLots : shortLots;
      if (action.open) book.push({ date: row.tradeDate, qty: row.quantity, price: row.price });
      else consume(book, row.quantity);
    }
    out.set(key, { long: remainingOf(longLots), short: remainingOf(shortLots) });
  }
  return out;
}

function positionKey(position: {
  accountId: string;
  underlying: string;
  instrument: BookInstrument;
  expiry: IsoDate | null;
  right: OptionRight | null;
  strike: number | null;
}): string {
  return lotKey(position);
}

/** Open positions plus the trade ledger. Transactions win. A position average is the fallback. */
export function assembleBook(positions: readonly BookPositionInput[], txns: readonly BookTxnInput[]): BookLeg[] {
  const parsedTxns: TxnLot[] = [];
  for (const txn of txns) {
    const parsed = parseOptionFromSchwabSymbol(txn.symbol);
    const asset = (txn.assetType ?? "").toUpperCase();
    const option = asset === "OPTION" || parsed != null || txn.optionRight != null;
    const right = rightOf(txn.optionRight, parsed?.right ?? null);
    const expiry = asDate(txn.optionExpiration) ?? asDate(parsed?.expiration ?? null);
    const strike = txn.optionStrike ?? parsed?.strike ?? null;
    const underlying = (txn.underlyingSymbol || parsed?.underlying || (option ? "" : txn.symbol) || "").trim().toUpperCase();
    const tradeDate = asDate(txn.tradeDate);
    if (!underlying || !tradeDate || txn.quantity == null) continue;
    if (option && (right == null || expiry == null || strike == null)) continue;
    parsedTxns.push({
      accountId: txn.accountId,
      underlying,
      instrument: option ? (right === "P" ? "put" : "call") : "stock",
      expiry: option ? expiry : null,
      right: option ? right : null,
      strike: option ? strike : null,
      tradeDate,
      quantity: Math.abs(txn.quantity),
      price: txn.price ?? 0,
      instruction: txn.instruction,
      positionEffect: txn.positionEffect,
    });
  }
  const lots = rebuildLots(parsedTxns);
  const legs: BookLeg[] = [];
  for (const row of positions) {
    if (!Number.isFinite(row.quantity) || row.quantity === 0) continue;
    const parsed = parseOptionFromSchwabSymbol(row.symbol);
    const type = row.securityType.toLowerCase();
    const option = type === "option" || parsed != null;
    if (!option && type !== "equity") continue;
    const right = option ? rightOf(row.optionType, parsed?.right ?? null) : null;
    const expiry = option ? asDate(row.expirationDate) ?? asDate(parsed?.expiration ?? null) : null;
    const strike = option ? (row.strikePrice ?? parsed?.strike ?? null) : null;
    const underlying = (row.underlyingSymbol || parsed?.underlying || (option ? "" : row.symbol) || "").trim().toUpperCase();
    if (!underlying) continue;
    if (option && (right == null || expiry == null || strike == null || !(strike > 0))) continue;
    const instrument: BookInstrument = option ? (right === "P" ? "put" : "call") : "stock";
    const average = resolvePositionAveragePrice(null, row.metadataJson);
    const positionPrice = average != null && average > 0 ? average : null;
    const purchase = purchaseDateOf(row.metadataJson);
    const key = positionKey({ accountId: row.accountId, underlying, instrument, expiry, right, strike });
    const book = lots.get(key);
    const remaining = row.quantity > 0 ? book?.long : book?.short;
    const target = Math.abs(row.quantity);
    const tolerance = instrument === "stock" ? Math.max(0.01, target * 0.01) : 1;
    const matched = remaining != null && Math.abs(remaining.qty - target) <= tolerance;
    const partial = remaining != null && !matched;
    let bookPrice: number | null = null;
    let bookDate: IsoDate | null = null;
    let costSource: BookCostSource = "missing";
    let dateSource: BookCostSource = "missing";
    let fillCount = 0;
    if (matched && remaining) {
      bookPrice = remaining.price;
      bookDate = remaining.date;
      costSource = "transactions";
      dateSource = "transactions";
      fillCount = remaining.fills;
    } else if (positionPrice != null) {
      bookPrice = positionPrice;
      costSource = "position";
      if (remaining) {
        bookDate = remaining.date;
        dateSource = "transactions";
        fillCount = remaining.fills;
      } else if (purchase) {
        bookDate = purchase;
        dateSource = "position";
      }
    } else if (purchase) {
      bookDate = purchase;
      dateSource = "position";
    }
    legs.push({
      id: row.id,
      accountId: row.accountId,
      accountLabel: row.accountLabel,
      underlying,
      instrument,
      expiry,
      right: option ? right : null,
      strike: option ? strike : null,
      quantity: row.quantity,
      bookPrice,
      bookDate,
      mark: markOf(instrument, row.quantity, row.price, row.marketValue),
      costSource,
      dateSource,
      fillCount,
      partial,
      missingCost: bookPrice == null,
    });
  }
  legs.sort((a, b) => {
    const account = a.accountLabel.localeCompare(b.accountLabel);
    if (account !== 0) return account;
    const under = a.underlying.localeCompare(b.underlying);
    if (under !== 0) return under;
    const expiry = (a.expiry ?? "").localeCompare(b.expiry ?? "");
    if (expiry !== 0) return expiry;
    return (a.strike ?? -1) - (b.strike ?? -1);
  });
  return legs;
}

export type BookNodeKind = "all" | "account" | "underlying" | "expiry" | "leg";

export type BookNode = {
  readonly id: string;
  readonly kind: BookNodeKind;
  readonly label: string;
  readonly legIds: readonly string[];
  readonly children: readonly BookNode[];
};

export type CheckState = "on" | "off" | "mixed";

function money(price: number): string {
  return `$${price.toFixed(2)}`;
}

export function bookLegLabel(leg: BookLeg): string {
  const side = leg.quantity > 0 ? "Long" : "Short";
  const qty = Number.isInteger(leg.quantity) ? String(Math.abs(leg.quantity)) : String(Math.round(Math.abs(leg.quantity) * 100) / 100);
  const name = leg.instrument === "stock" ? `${qty} shares` : `${qty} ${leg.strike} ${leg.instrument}`;
  const cost = leg.missingCost || leg.bookPrice == null ? "no cost basis" : money(leg.bookPrice);
  const when = leg.bookDate ? ` · ${leg.bookDate}` : "";
  const fills = leg.fillCount > 1 ? ` · ${leg.fillCount} fills` : "";
  const partial = leg.partial ? " · position average" : "";
  return `${side} ${name} · ${cost}${when}${fills}${partial}`;
}

function groupLegs(legs: readonly BookLeg[]): BookNode {
  const accounts = new Map<string, BookLeg[]>();
  for (const leg of legs) {
    const list = accounts.get(leg.accountId);
    if (list) list.push(leg);
    else accounts.set(leg.accountId, [leg]);
  }
  const accountNodes: BookNode[] = [];
  for (const [accountId, accountLegs] of accounts) {
    const underlyings = new Map<string, BookLeg[]>();
    for (const leg of accountLegs) {
      const list = underlyings.get(leg.underlying);
      if (list) list.push(leg);
      else underlyings.set(leg.underlying, [leg]);
    }
    const underlyingNodes: BookNode[] = [];
    for (const [symbol, underLegs] of underlyings) {
      const expiries = new Map<string, BookLeg[]>();
      for (const leg of underLegs) {
        const key = leg.instrument === "stock" || leg.expiry == null ? "stock" : leg.expiry;
        const list = expiries.get(key);
        if (list) list.push(leg);
        else expiries.set(key, [leg]);
      }
      const expiryNodes: BookNode[] = [...expiries.entries()]
        .sort((a, b) => (a[0] === "stock" ? -1 : b[0] === "stock" ? 1 : a[0] < b[0] ? -1 : 1))
        .map(([key, group]) => {
          const children = group.map(
            (leg): BookNode => ({
              id: `leg:${leg.id}`,
              kind: "leg",
              label: bookLegLabel(leg),
              legIds: [leg.id],
              children: [],
            }),
          );
          return {
            id: `account:${accountId}|under:${symbol}|exp:${key}`,
            kind: "expiry",
            label: key === "stock" ? "Shares" : key,
            legIds: children.flatMap((child) => child.legIds),
            children,
          };
        });
      underlyingNodes.push({
        id: `account:${accountId}|under:${symbol}`,
        kind: "underlying",
        label: symbol,
        legIds: expiryNodes.flatMap((child) => child.legIds),
        children: expiryNodes,
      });
    }
    underlyingNodes.sort((a, b) => a.label.localeCompare(b.label));
    accountNodes.push({
      id: `account:${accountId}`,
      kind: "account",
      label: accountLegs[0]?.accountLabel ?? accountId,
      legIds: underlyingNodes.flatMap((child) => child.legIds),
      children: underlyingNodes,
    });
  }
  accountNodes.sort((a, b) => a.label.localeCompare(b.label));
  return {
    id: "all",
    kind: "all",
    label: "All accounts",
    legIds: accountNodes.flatMap((child) => child.legIds),
    children: accountNodes,
  };
}

export function buildBookTree(legs: readonly BookLeg[]): BookNode {
  return groupLegs(legs);
}

export function nodeState(legIds: readonly string[], selected: ReadonlySet<string>): CheckState {
  if (legIds.length === 0) return "off";
  let on = 0;
  for (const id of legIds) if (selected.has(id)) on += 1;
  if (on === 0) return "off";
  if (on === legIds.length) return "on";
  return "mixed";
}

/** A checked or mixed node becomes fully checked. A checked node clears its leaves. */
export function toggleNode(legIds: readonly string[], selected: ReadonlySet<string>): Set<string> {
  const next = new Set(selected);
  if (nodeState(legIds, selected) === "on") {
    for (const id of legIds) next.delete(id);
  } else {
    for (const id of legIds) next.add(id);
  }
  return next;
}

export function selectionCost(legs: readonly BookLeg[], selected: ReadonlySet<string>): {
  readonly count: number;
  readonly net: number;
  readonly priced: number;
  readonly missing: number;
} {
  let net = 0;
  let priced = 0;
  let missing = 0;
  let count = 0;
  for (const leg of legs) {
    if (!selected.has(leg.id)) continue;
    count += 1;
    if (leg.bookPrice == null) {
      missing += 1;
      continue;
    }
    const multiplier = leg.instrument === "stock" ? 1 : 100;
    net += leg.quantity * leg.bookPrice * multiplier;
    priced += 1;
  }
  return { count, net, priced, missing };
}
