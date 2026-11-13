import type { Snapshot } from "@/lib/fortress/types";
import { DEFAULT_MARGIN } from "@/lib/fortress/types";

export type UserBookLine = { readonly symbol: string; readonly shares: number; readonly price: number };

export type UserBookInput = {
  readonly asOf: string;
  readonly lines: readonly UserBookLine[];
  /** Null means cash was not recorded. Zero is a recorded zero only when the number is present. */
  readonly cash: number | null;
  readonly debt: number | null;
};

export type UserBookResult = { readonly ok: true; readonly snapshot: Snapshot } | { readonly ok: false; readonly reason: string };

/** A generic portfolio the person typed. It is not the household book and not a broker import. */
export function buildUserBook(input: UserBookInput): UserBookResult {
  const positions: Array<Snapshot["positions"][number]> = [];
  for (const line of input.lines) {
    const symbol = line.symbol.trim().toUpperCase();
    if (!symbol) continue;
    if (!Number.isFinite(line.shares) || line.shares === 0) return { ok: false, reason: `${symbol} needs a non-zero share count. Shorts are a negative share count.` };
    if (!Number.isFinite(line.price) || !(line.price > 0)) return { ok: false, reason: `${symbol} needs a positive price.` };
    positions.push({
      id: `user-${positions.length + 1}-${symbol}`,
      kind: "equity",
      symbol,
      accountId: "primary",
      quantity: line.shares,
      mark: line.price,
      averageCost: line.price,
    });
  }
  if (positions.length === 0) return { ok: false, reason: "Type at least one ticker, share count, and price." };
  if (input.cash != null && !Number.isFinite(input.cash)) return { ok: false, reason: "Recorded cash must be a number." };
  if (input.debt != null && (!Number.isFinite(input.debt) || input.debt < 0)) return { ok: false, reason: "Recorded debt must be zero or positive." };

  const snapshot: Snapshot = {
    id: "user-book",
    version: 1,
    currency: "USD",
    asOf: input.asOf,
    seed: 1,
    scope: { regime: "user", label: "User-supplied portfolio. Not the household book and not a broker import." },
    completeness: {
      cash: input.cash == null ? "missing" : "recorded",
      debt: input.debt == null ? "missing" : "recorded",
      contracts: "recorded",
      quotes: "recorded",
      dividends: "explicit-zero",
    },
    vintages: { quotes: "user-typed", model: "fortress-ledger-1", rules: "manual-margin-1" },
    positions,
    cash: input.cash == null ? [] : [{ id: "cash", accountId: "primary", amount: input.cash }],
    receivables: [],
    payables: [],
    debt: input.debt == null ? [] : [{ id: "debt", accountId: "primary", principal: input.debt, annualRate: 0 }],
    dividends: [],
    margin: DEFAULT_MARGIN,
    appliedOpIds: [],
    appliedEventIds: [],
    realized: [],
    residuals: [],
    externalCapital: 0,
  };
  return { ok: true, snapshot };
}
