import { isoDate, type IsoDate, type OptionRight } from "@/lib/optionChain/chain";
import { HELD_LEG_CAP, OPTION_QTY_CAP } from "@/lib/strategyLab/legs";
import { parseOptionFromSchwabSymbol } from "@/lib/strategy/optionParse";

export type HeldStockLeg = { readonly shares: number; readonly averagePrice: number };

export type HeldAccountRef = {
  readonly id: string;
  readonly name: string;
  readonly nickname: string | null;
};

export type HeldAccountChoice = {
  readonly id: string;
  readonly label: string;
  readonly legs: number;
};

export type HeldBookSummary = {
  readonly legs: number;
  readonly contracts: number;
  readonly expiries: readonly IsoDate[];
  readonly shares: number | null;
  readonly stockOmitted: boolean;
};

export type HeldPositionRow = {
  readonly positionId?: string | null;
  readonly accountId?: string | null;
  readonly symbol?: string | null;
  readonly quantity?: number | null;
  readonly averagePrice?: number | null;
  readonly price?: number | null;
  readonly securityType?: string | null;
  readonly underlyingSymbol?: string | null;
  readonly effectiveUnderlyingSymbol?: string | null;
  readonly optionExpiration?: string | null;
  readonly optionRight?: string | null;
  readonly optionStrike?: number | null;
};

export type HeldLeg = {
  readonly right: OptionRight;
  readonly strike: number;
  readonly quantity: number;
  readonly averagePrice: number | null;
  /** Signed premium: average price times contracts. Null when any lot has no average. */
  readonly contribution: number | null;
};

export type HeldBook = {
  readonly key: string;
  readonly underlying: string;
  readonly expiry: IsoDate;
  readonly legs: readonly HeldLeg[];
  readonly accountCount: number;
  /** Sum of leg contributions. Null when a selected-ready leg has no average cost. */
  readonly averageNetPerShare: number | null;
};

export type HeldStock = {
  readonly underlying: string;
  readonly shares: number;
  readonly averagePrice: number | null;
};

export type HeldGroups = {
  readonly books: readonly HeldBook[];
  readonly stocks: readonly HeldStock[];
  readonly unparsed: number;
};

export type HeldDraft = {
  readonly label: string;
  readonly expiry: IsoDate;
  readonly legs: readonly { readonly right: OptionRight; readonly strike: number; readonly ratio: number; readonly expiry: IsoDate }[];
  readonly netPerShare: number;
  readonly stock: HeldStockLeg | null;
};

type OptionLot = {
  underlying: string;
  expiry: IsoDate;
  right: OptionRight;
  strike: number;
  quantity: number;
  averagePrice: number | null;
  accountId: string | null;
};

function underlyingOf(row: HeldPositionRow, parsedRoot: string | null): string | null {
  const named = (row.effectiveUnderlyingSymbol || row.underlyingSymbol || parsedRoot || "").trim().toUpperCase();
  return named || null;
}

function contractsOf(quantity: number | null | undefined): number | null {
  if (quantity == null || !Number.isFinite(quantity) || quantity === 0) return null;
  const rounded = Math.round(quantity);
  if (Math.abs(quantity - rounded) > 1e-6) return null;
  if (Math.abs(rounded) > OPTION_QTY_CAP) return null;
  return rounded;
}

function optionLot(row: HeldPositionRow): OptionLot | "skip" | "unparsed" {
  const type = (row.securityType ?? "").toLowerCase();
  const parsed = parseOptionFromSchwabSymbol(row.symbol);
  const looksOption = type === "option" || parsed != null;
  if (!looksOption) return "skip";
  const right = parsed?.right ?? (row.optionRight === "C" || row.optionRight === "P" ? row.optionRight : null);
  const expiryText = parsed?.expiration ?? row.optionExpiration ?? null;
  const strike = parsed?.strike ?? row.optionStrike ?? null;
  if (!right || !expiryText || strike == null || !(strike > 0)) return "unparsed";
  let expiry: IsoDate;
  try {
    expiry = isoDate(expiryText);
  } catch {
    return "unparsed";
  }
  const underlying = underlyingOf(row, parsed?.underlying ?? null);
  if (!underlying) return "unparsed";
  const quantity = contractsOf(row.quantity);
  if (quantity == null) return row.quantity == null || row.quantity === 0 ? "skip" : "unparsed";
  const averagePrice = row.averagePrice != null && Number.isFinite(row.averagePrice) ? row.averagePrice : null;
  return {
    underlying,
    expiry,
    right,
    strike,
    quantity,
    averagePrice,
    accountId: row.accountId ?? null,
  };
}

function stockRow(row: HeldPositionRow): { underlying: string; shares: number; averagePrice: number | null } | null {
  const type = (row.securityType ?? "").toLowerCase();
  if (type === "option" || type === "cash") return null;
  if (parseOptionFromSchwabSymbol(row.symbol)) return null;
  const shares = row.quantity;
  if (shares == null || !Number.isFinite(shares) || shares === 0 || Math.abs(shares) > 1_000_000) return null;
  const underlying = underlyingOf(row, null) || (row.symbol ?? "").trim().toUpperCase();
  if (!underlying) return null;
  const averagePrice = row.averagePrice != null && Number.isFinite(row.averagePrice) && row.averagePrice > 0 ? row.averagePrice : null;
  return { underlying, shares, averagePrice };
}

/** Open option books grouped by underlying and expiry, plus share lots by underlying. */
export function groupHeldPositions(rows: readonly HeldPositionRow[]): HeldGroups {
  const lots: OptionLot[] = [];
  let unparsed = 0;
  const stockLots: { underlying: string; shares: number; averagePrice: number | null }[] = [];
  for (const row of rows) {
    const lot = optionLot(row);
    if (lot === "unparsed") {
      unparsed += 1;
      continue;
    }
    if (lot !== "skip") {
      lots.push(lot);
      continue;
    }
    const stock = stockRow(row);
    if (stock) stockLots.push(stock);
  }

  const books = new Map<string, { lots: OptionLot[]; accounts: Set<string> }>();
  for (const lot of lots) {
    const key = `${lot.underlying}|${lot.expiry}`;
    const book = books.get(key) ?? { lots: [], accounts: new Set<string>() };
    book.lots.push(lot);
    if (lot.accountId) book.accounts.add(lot.accountId);
    books.set(key, book);
  }

  const heldBooks: HeldBook[] = [];
  for (const [key, book] of books) {
    const first = book.lots[0]!;
    const merged = new Map<string, { right: OptionRight; strike: number; quantity: number; cash: number; missing: boolean }>();
    for (const lot of book.lots) {
      const legKey = `${lot.right}|${lot.strike}`;
      const current = merged.get(legKey) ?? { right: lot.right, strike: lot.strike, quantity: 0, cash: 0, missing: false };
      current.quantity += lot.quantity;
      if (lot.averagePrice == null) current.missing = true;
      else current.cash += lot.averagePrice * lot.quantity;
      merged.set(legKey, current);
    }
    const legs: HeldLeg[] = [];
    for (const leg of merged.values()) {
      if (leg.quantity === 0) continue;
      const contribution = leg.missing ? null : leg.cash;
      legs.push({
        right: leg.right,
        strike: leg.strike,
        quantity: leg.quantity,
        averagePrice: contribution == null ? null : contribution / leg.quantity,
        contribution,
      });
    }
    legs.sort((a, b) => a.strike - b.strike || (a.right === b.right ? 0 : a.right === "P" ? -1 : 1));
    const missing = legs.some((leg) => leg.contribution == null);
    heldBooks.push({
      key,
      underlying: first.underlying,
      expiry: first.expiry,
      legs,
      accountCount: book.accounts.size,
      averageNetPerShare: missing ? null : legs.reduce((sum, leg) => sum + (leg.contribution ?? 0), 0),
    });
  }
  heldBooks.sort((a, b) => a.underlying.localeCompare(b.underlying) || a.expiry.localeCompare(b.expiry));

  const stocks = new Map<string, { shares: number; cash: number; missing: boolean }>();
  for (const lot of stockLots) {
    const current = stocks.get(lot.underlying) ?? { shares: 0, cash: 0, missing: false };
    current.shares += lot.shares;
    if (lot.averagePrice == null) current.missing = true;
    else current.cash += lot.averagePrice * lot.shares;
    stocks.set(lot.underlying, current);
  }
  const heldStocks: HeldStock[] = [...stocks.entries()]
    .filter(([, lot]) => lot.shares !== 0)
    .map(([underlying, lot]) => ({
      underlying,
      shares: lot.shares,
      averagePrice: lot.missing || lot.shares === 0 ? null : lot.cash / lot.shares,
    }))
    .sort((a, b) => a.underlying.localeCompare(b.underlying));

  return { books: heldBooks, stocks: heldStocks, unparsed };
}

export function accountChoiceLabel(account: HeldAccountRef): string {
  const nick = account.nickname?.trim();
  if (nick) return nick;
  const name = account.name.trim();
  return name || account.id;
}

function optionLegCount(rows: readonly HeldPositionRow[], symbol: string): number {
  return booksFor(groupHeldPositions(rows), symbol).reduce((sum, book) => sum + book.legs.length, 0);
}

/** All-accounts composite, then each account that holds this underlying. */
export function heldAccountChoices(
  rows: readonly HeldPositionRow[],
  symbol: string,
  accounts: readonly HeldAccountRef[],
): readonly HeldAccountChoice[] {
  const names = new Map(accounts.map((account) => [account.id, accountChoiceLabel(account)]));
  const ids = [...new Set(rows.map((row) => row.accountId).filter((id): id is string => Boolean(id)))].sort((a, b) =>
    (names.get(a) ?? a).localeCompare(names.get(b) ?? b),
  );
  const choices = ids
    .map((id) => ({
      id,
      label: names.get(id) ?? id,
      legs: optionLegCount(
        rows.filter((row) => row.accountId === id),
        symbol,
      ),
    }))
    .filter((choice) => choice.legs > 0);
  const allLegs = optionLegCount(rows, symbol);
  if (allLegs < 1) return [];
  return [{ id: "all", label: "All accounts", legs: allLegs }, ...choices];
}

export function stockFor(groups: HeldGroups, underlying: string): HeldStock | null {
  return groups.stocks.find((stock) => stock.underlying === underlying.toUpperCase()) ?? null;
}

export function booksFor(groups: HeldGroups, underlying: string): HeldBook[] {
  const symbol = underlying.toUpperCase();
  return groups.books.filter((book) => book.underlying === symbol);
}

/**
 * Turn selected legs into a custom structure at average cost.
 * A short call plus long shares is labeled as covered. The share leg is optional.
 */
export function draftHeldStructure(input: {
  readonly book: HeldBook;
  readonly legIndexes: readonly number[];
  readonly stock: HeldStock | null;
  readonly includeStock: boolean;
}): { ok: true; draft: HeldDraft } | { ok: false; error: string } {
  const indexes = [...new Set(input.legIndexes)].filter((index) => index >= 0 && index < input.book.legs.length);
  if (indexes.length < 1) return { ok: false, error: "Select at least one leg." };
  if (indexes.length > HELD_LEG_CAP) return { ok: false, error: "This book has more legs than the lab can draw." };
  const selected = indexes.map((index) => input.book.legs[index]!);
  if (selected.some((leg) => leg.contribution == null || leg.averagePrice == null)) {
    return { ok: false, error: "A selected leg has no average cost, so it was not priced at the mid." };
  }
  const legs = selected.map((leg) => ({ right: leg.right, strike: leg.strike, ratio: leg.quantity, expiry: input.book.expiry }));
  const netPerShare = selected.reduce((sum, leg) => sum + (leg.contribution ?? 0), 0);
  let stock: HeldStockLeg | null = null;
  if (input.includeStock) {
    if (!input.stock) return { ok: false, error: "No share position is open for this underlying." };
    if (input.stock.averagePrice == null) return { ok: false, error: "The shares have no average cost." };
    if (!(Math.abs(input.stock.shares) > 0) || Math.abs(input.stock.shares) > 1_000_000) {
      return { ok: false, error: "The share count cannot be a stock leg." };
    }
    stock = { shares: input.stock.shares, averagePrice: input.stock.averagePrice };
  }
  const covered = stock != null && stock.shares > 0 && legs.some((leg) => leg.right === "C" && leg.ratio < 0);
  const label = `${covered ? "Covered" : "Held"} ${input.book.expiry}`.slice(0, 40);
  return { ok: true, draft: { label, expiry: input.book.expiry, legs, netPerShare, stock } };
}

/** One structure from legs on more than one expiry. A held calendar is two books, not two structures. */
export function draftHeldSelection(input: {
  readonly books: readonly { readonly book: HeldBook; readonly legIndexes: readonly number[] }[];
  readonly stock: HeldStock | null;
  readonly includeStock: boolean;
}): { ok: true; draft: HeldDraft } | { ok: false; error: string } {
  const picked = input.books.filter((item) => item.legIndexes.length > 0);
  if (picked.length < 1) return { ok: false, error: "Select at least one leg." };
  const drafts = [];
  for (const item of picked) {
    const one = draftHeldStructure({ book: item.book, legIndexes: item.legIndexes, stock: null, includeStock: false });
    if (!one.ok) return one;
    drafts.push(one.draft);
  }
  const legs = drafts.flatMap((draft) => draft.legs);
  if (legs.length + (input.includeStock ? 1 : 0) > HELD_LEG_CAP) return { ok: false, error: "This book has more legs than the lab can draw." };
  let stock: HeldStockLeg | null = null;
  if (input.includeStock) {
    if (!input.stock || input.stock.averagePrice == null) return { ok: false, error: "The shares have no average cost." };
    stock = { shares: input.stock.shares, averagePrice: input.stock.averagePrice };
  }
  const expiry = legs.map((leg) => leg.expiry).reduce((a, b) => (a > b ? a : b));
  const netPerShare = drafts.reduce((sum, draft) => sum + draft.netPerShare, 0);
  const covered = stock != null && stock.shares > 0 && legs.some((leg) => leg.right === "C" && leg.ratio < 0);
  const label = (picked.length > 1 ? `${covered ? "Covered" : "Held"} calendar` : drafts[0]!.label).slice(0, 40);
  return { ok: true, draft: { label, expiry, legs, netPerShare, stock } };
}

/**
 * Every open leg for one account, or the all-accounts composite, as one structure.
 * Shares come along when they have an average cost. Nothing is dropped for size.
 */
export function draftHeldBook(input: {
  readonly rows: readonly HeldPositionRow[];
  readonly symbol: string;
  readonly accountId: string;
  readonly accountLabel: string;
}): { ok: true; draft: HeldDraft; summary: HeldBookSummary } | { ok: false; error: string } {
  const filtered = input.accountId === "all" ? input.rows : input.rows.filter((row) => row.accountId === input.accountId);
  const groups = groupHeldPositions(filtered);
  const books = booksFor(groups, input.symbol);
  const stock = stockFor(groups, input.symbol);
  if (books.length < 1) return { ok: false, error: `No open option positions for ${input.symbol}.` };
  const includeStock = stock != null && stock.averagePrice != null && stock.shares !== 0;
  const selection = draftHeldSelection({
    books: books.map((book) => ({ book, legIndexes: book.legs.map((_, index) => index) })),
    stock,
    includeStock,
  });
  if (!selection.ok) return selection;
  const label = (input.accountId === "all" ? `Held ${input.symbol}` : `Held ${input.accountLabel}`).slice(0, 40);
  const contracts = books.reduce((sum, book) => sum + book.legs.reduce((legSum, leg) => legSum + Math.abs(leg.quantity), 0), 0);
  return {
    ok: true,
    draft: { ...selection.draft, label },
    summary: {
      legs: selection.draft.legs.length + (selection.draft.stock ? 1 : 0),
      contracts,
      expiries: [...new Set(selection.draft.legs.map((leg) => leg.expiry))],
      shares: selection.draft.stock?.shares ?? null,
      stockOmitted: stock != null && !includeStock,
    },
  };
}
