import type { Change, OptionContract } from "@/lib/fortress/types";

export type ChangeDraft = {
  readonly op: Change["op"];
  readonly accountId: string;
  readonly symbol: string;
  readonly quantity: string;
  readonly price: string;
  readonly amount: string;
  readonly fee: string;
  readonly tradeDate: string;
  readonly toAccountId: string;
  readonly maintenance: string;
  readonly initial: string;
  readonly right: "C" | "P";
  readonly strike: string;
  readonly expiry: string;
  readonly positionId: string;
  readonly proportional: string;
};

export const EMPTY_DRAFT: ChangeDraft = {
  op: "trimEquity",
  accountId: "primary",
  symbol: "SYN",
  quantity: "100",
  price: "100",
  amount: "1000",
  fee: "0",
  tradeDate: "2026-11-06",
  toAccountId: "reserve",
  maintenance: "0.30",
  initial: "0.50",
  right: "P",
  strike: "100",
  expiry: "2027-01-15",
  positionId: "",
  proportional: "",
};

function num(value: string): number | null {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function contract(draft: ChangeDraft): OptionContract | string {
  const strike = num(draft.strike);
  if (strike == null || !(strike > 0)) return "Strike must be positive.";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(draft.expiry)) return "Expiry is YYYY-MM-DD.";
  return {
    underlying: draft.symbol.trim().toUpperCase(),
    right: draft.right,
    strike,
    expiry: draft.expiry,
    style: "american",
    multiplier: 100,
    deliverableShares: 100,
    settlement: "physical",
    adjusted: false,
    adjustedMetadata: "complete",
    exotic: false,
  };
}

export function buildChange(draft: ChangeDraft, seq: number): { readonly ok: true; readonly change: Change } | { readonly ok: false; readonly reason: string } {
  const id = `op-${seq}`;
  const price = num(draft.price);
  const quantity = num(draft.quantity);
  const amount = num(draft.amount);
  const fee = num(draft.fee) ?? 0;
  const fill = price != null && price > 0 ? { price, tradeDate: draft.tradeDate, fee } : null;
  switch (draft.op) {
    case "addEquity": {
      if (!fill || quantity == null || !(quantity > 0)) return { ok: false, reason: "Quantity and price must be positive. A trim cannot open a short." };
      return { ok: true, change: { op: "addEquity", id, accountId: draft.accountId, symbol: draft.symbol.trim().toUpperCase(), instrument: "equity", quantity, fill } };
    }
    case "trimEquity": {
      if (!fill || quantity == null || !(quantity > 0)) return { ok: false, reason: "Quantity and price must be positive. A trim cannot open a short." };
      return { ok: true, change: { op: "trimEquity", id, accountId: draft.accountId, symbol: draft.symbol.trim().toUpperCase(), quantity, fill } };
    }
    case "replace": {
      if (!fill || quantity == null) return { ok: false, reason: "Replacement needs a sale quantity and prices." };
      const proportional = num(draft.proportional);
      const sellQuantity = proportional != null && proportional > 0 && proportional <= 1 ? { proportional } : quantity;
      if (typeof sellQuantity === "number" && !(sellQuantity > 0)) return { ok: false, reason: "Sale quantity must be positive." };
      return {
        ok: true,
        change: {
          op: "replace",
          id,
          accountId: draft.accountId,
          sellSymbol: draft.symbol.trim().toUpperCase(),
          sellQuantity,
          buySymbol: draft.toAccountId.trim().toUpperCase() || "NEW",
          buyInstrument: "equity",
          sellFill: fill,
          buyFill: { ...fill, price: amount != null && amount > 0 ? amount : fill.price },
        },
      };
    }
    case "openOption":
    case "roll": {
      const built = contract(draft);
      if (typeof built === "string") return { ok: false, reason: built };
      if (!fill || quantity == null || quantity === 0) return { ok: false, reason: "Option quantity is signed and not zero. Price is the premium per share." };
      if (draft.op === "openOption") return { ok: true, change: { op: "openOption", id, accountId: draft.accountId, quantity, contract: built, fill } };
      if (!draft.positionId.trim()) return { ok: false, reason: "A roll needs the open position id to close." };
      return {
        ok: true,
        change: {
          op: "roll",
          id,
          timing: "simultaneous",
          close: { positionId: draft.positionId.trim(), quantity: Math.abs(quantity), fill },
          open: { accountId: draft.accountId, quantity, contract: built, fill },
        },
      };
    }
    case "closeOption": {
      if (!fill || quantity == null || !(quantity > 0) || !draft.positionId.trim()) return { ok: false, reason: "Close needs a position id, a positive quantity, and a premium." };
      return { ok: true, change: { op: "closeOption", id, positionId: draft.positionId.trim(), quantity, fill } };
    }
    case "deposit":
    case "withdraw":
    case "borrow":
    case "repay": {
      if (amount == null || !(amount > 0)) return { ok: false, reason: "Amount must be positive." };
      if (draft.op === "borrow" || draft.op === "repay") {
        return { ok: true, change: { op: draft.op, id, accountId: draft.accountId, amount, annualRate: 0, tradeDate: draft.tradeDate } };
      }
      return { ok: true, change: { op: draft.op, id, accountId: draft.accountId, amount, tradeDate: draft.tradeDate } };
    }
    case "transfer": {
      if (amount == null || !(amount > 0)) return { ok: false, reason: "Amount must be positive." };
      return { ok: true, change: { op: "transfer", id, fromAccountId: draft.accountId, toAccountId: draft.toAccountId, amount, tradeDate: draft.tradeDate } };
    }
    case "setMargin": {
      const maintenance = num(draft.maintenance);
      const initial = num(draft.initial);
      if (maintenance == null || initial == null) return { ok: false, reason: "Margin fractions are numbers." };
      return { ok: true, change: { op: "setMargin", id, maintenanceLong: maintenance, initialLong: initial } };
    }
    default:
      return { ok: false, reason: "That change is not in phase 2." };
  }
}
