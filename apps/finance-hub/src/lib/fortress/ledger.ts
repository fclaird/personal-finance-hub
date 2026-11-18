import { addCalendarDays } from "@/lib/fortress/dates";
import type { Assumptions, CashLine, Change, DatedFlow, EquityPosition, Fill, OptionPosition, Position, Snapshot } from "@/lib/fortress/types";
import { DEFAULT_ASSUMPTIONS } from "@/lib/fortress/types";

export type ApplyResult = {
  readonly snapshot: Snapshot;
  readonly accepted: boolean;
  readonly reason: string | null;
};

export type NavResult = { readonly status: "known"; readonly value: number } | { readonly status: "unknown"; readonly reason: string };

export function cloneSnapshot(snapshot: Snapshot): Snapshot {
  return structuredClone(snapshot);
}

export function sumAmount(rows: readonly { amount: number }[]): number {
  return rows.reduce((sum, row) => sum + row.amount, 0);
}

export function debtPrincipal(snapshot: Snapshot): number {
  return snapshot.debt.reduce((sum, row) => sum + row.principal, 0);
}

export function settledCash(snapshot: Snapshot, accountId?: string): number {
  return snapshot.cash.reduce((sum, row) => (accountId && row.accountId !== accountId ? sum : sum + row.amount), 0);
}

/** Position market value. A short option with a positive mark is a negative asset, not a second payable. */
export function positionValue(position: Position): number | null {
  if (position.kind === "option") {
    if (position.mark == null || !Number.isFinite(position.mark)) return null;
    return position.quantity * position.mark * position.contract.multiplier;
  }
  if (!Number.isFinite(position.mark)) return null;
  return position.quantity * position.mark;
}

export function netAssetValue(snapshot: Snapshot): NavResult {
  let assets = 0;
  for (const position of snapshot.positions) {
    const value = positionValue(position);
    if (value == null) return { status: "unknown", reason: `Mark missing on ${position.id}.` };
    assets += value;
  }
  const nav = assets + settledCash(snapshot) + sumAmount(snapshot.receivables) - sumAmount(snapshot.payables) - debtPrincipal(snapshot);
  return { status: "known", value: nav };
}

function cashLine(snapshot: Snapshot, accountId: string): CashLine[] {
  const rows = snapshot.cash.filter((row) => row.accountId !== accountId);
  const current = snapshot.cash.find((row) => row.accountId === accountId);
  return [...rows, { id: current?.id ?? `cash:${accountId}`, accountId, amount: current?.amount ?? 0 }];
}

function addCash(snapshot: Snapshot, accountId: string, amount: number): Snapshot {
  const current = snapshot.cash.find((row) => row.accountId === accountId)?.amount ?? 0;
  return { ...snapshot, cash: cashLine(snapshot, accountId).map((row) => (row.accountId === accountId ? { ...row, amount: current + amount } : row)) };
}

function pushFlow(rows: readonly DatedFlow[], flow: DatedFlow): DatedFlow[] {
  return [...rows, flow];
}

export function settleDue(snapshot: Snapshot, asOf: string): Snapshot {
  let next = snapshot;
  const dueIn = snapshot.receivables.filter((row) => row.due <= asOf);
  const keepIn = snapshot.receivables.filter((row) => row.due > asOf);
  next = { ...next, receivables: keepIn };
  for (const row of dueIn) next = addCash(next, row.accountId, row.amount);
  const dueOut = next.payables.filter((row) => row.due <= asOf);
  const keepOut: DatedFlow[] = next.payables.filter((row) => row.due > asOf);
  const still: DatedFlow[] = [];
  for (const row of dueOut) {
    const have = settledCash(next, row.accountId);
    if (have + 1e-8 >= row.amount) {
      next = addCash(next, row.accountId, -row.amount);
    } else {
      still.push(row);
    }
  }
  return { ...next, payables: [...keepOut, ...still] };
}

function reject(snapshot: Snapshot, reason: string): ApplyResult {
  return { snapshot, accepted: false, reason };
}

function feePayable(snapshot: Snapshot, accountId: string, fee: number, due: string, id: string): Snapshot {
  if (!(fee > 0)) return snapshot;
  return { ...snapshot, payables: pushFlow(snapshot.payables, { id: `${id}:fee`, accountId, amount: fee, due, label: "Trade fee" }) };
}

function findEquity(snapshot: Snapshot, accountId: string, symbol: string): EquityPosition | null {
  const found = snapshot.positions.find((position) => position.kind !== "option" && position.accountId === accountId && position.symbol === symbol);
  return found && found.kind !== "option" ? found : null;
}

function upsertEquity(snapshot: Snapshot, position: EquityPosition): Snapshot {
  const rest = snapshot.positions.filter((row) => row.id !== position.id);
  if (Math.abs(position.quantity) < 1e-10) return { ...snapshot, positions: rest };
  return { ...snapshot, positions: [...rest, position] };
}

function addShares(snapshot: Snapshot, accountId: string, symbol: string, instrument: "equity" | "etf", quantity: number, fill: Fill, id: string, assumptions: Assumptions): Snapshot {
  const existing = findEquity(snapshot, accountId, symbol);
  const prevQty = existing?.quantity ?? 0;
  const prevCost = existing?.averageCost ?? fill.price;
  const nextQty = prevQty + quantity;
  const averageCost = quantity > 0 && Math.abs(nextQty) > 1e-10 ? (Math.max(prevQty, 0) * prevCost + quantity * fill.price) / nextQty : prevCost;
  let next = upsertEquity(snapshot, {
    id: existing?.id ?? id,
    kind: instrument,
    symbol,
    accountId,
    quantity: nextQty,
    mark: fill.price,
    averageCost,
  });
  const settlement = addCalendarDays(fill.tradeDate, assumptions.settlementDays);
  const notion = quantity * fill.price;
  if (quantity > 0) {
    next = { ...next, payables: pushFlow(next.payables, { id: `${id}:pay`, accountId, amount: notion, due: settlement, label: `Buy ${symbol}` }) };
  } else {
    next = {
      ...next,
      receivables: pushFlow(next.receivables, { id: `${id}:recv`, accountId, amount: -notion, due: settlement, label: `Sell ${symbol}` }),
    };
  }
  next = feePayable(next, accountId, fill.fee, fill.tradeDate, id);
  const model = existing?.mark ?? fill.price;
  const residual = (fill.price - model) * quantity;
  return {
    ...next,
    residuals: [...next.residuals, { id: `${id}:residual`, amount: residual, label: `Fill versus prior mark ${symbol}` }],
  };
}

function applyOne(snapshot: Snapshot, change: Change, assumptions: Assumptions): ApplyResult {
  if (snapshot.appliedOpIds.includes(change.id)) return { snapshot, accepted: true, reason: null };
  const stamped = (next: Snapshot): Snapshot => ({ ...next, appliedOpIds: [...next.appliedOpIds, change.id] });

  switch (change.op) {
    case "addEquity": {
      if (!(change.quantity > 0)) return reject(snapshot, "An add needs a positive quantity. A short open is a different operation and is not implied.");
      if (!(change.fill.price > 0)) return reject(snapshot, "Fill price must be positive.");
      return { snapshot: settleDue(stamped(addShares(snapshot, change.accountId, change.symbol, change.instrument, change.quantity, change.fill, change.id, assumptions)), change.fill.tradeDate), accepted: true, reason: null };
    }
    case "trimEquity": {
      if (!(change.quantity > 0)) return reject(snapshot, "A trim quantity is the positive number of shares sold.");
      const existing = findEquity(snapshot, change.accountId, change.symbol);
      if (!existing || existing.quantity + 1e-8 < change.quantity) {
        return reject(snapshot, "A trim cannot exceed the long shares in that account, and it cannot open a short.");
      }
      const sold = addShares(snapshot, change.accountId, change.symbol, existing.kind, -change.quantity, change.fill, change.id, assumptions);
      const realized = (change.fill.price - existing.averageCost) * change.quantity;
      const next = {
        ...sold,
        realized: [...sold.realized, { id: `${change.id}:realized`, amount: realized, label: `Trim ${change.symbol}` }],
      };
      return { snapshot: settleDue(stamped(next), change.fill.tradeDate), accepted: true, reason: null };
    }
    case "replace": {
      const existing = findEquity(snapshot, change.accountId, change.sellSymbol);
      const long = existing?.quantity ?? 0;
      const sellQty = typeof change.sellQuantity === "number" ? change.sellQuantity : long * change.sellQuantity.proportional;
      if (!(sellQty > 0) || !existing || long + 1e-8 < sellQty) return reject(snapshot, "The replacement sale is larger than the long shares.");
      const sold = applyOne(snapshot, { op: "trimEquity", id: `${change.id}:sell`, accountId: change.accountId, symbol: change.sellSymbol, quantity: sellQty, fill: change.sellFill }, assumptions);
      if (!sold.accepted) return sold;
      const proceeds = sellQty * change.sellFill.price - change.sellFill.fee;
      const buyQty = Math.floor((proceeds / change.buyFill.price) * 1e8) / 1e8;
      if (!(buyQty > 0)) return reject(sold.snapshot, "Residual cash does not buy a positive quantity.");
      const bought = applyOne(sold.snapshot, {
        op: "addEquity",
        id: `${change.id}:buy`,
        accountId: change.accountId,
        symbol: change.buySymbol,
        instrument: change.buyInstrument,
        quantity: buyQty,
        fill: change.buyFill,
      }, assumptions);
      if (!bought.accepted) return bought;
      return { snapshot: stamped(bought.snapshot), accepted: true, reason: null };
    }
    case "openOption": {
      const block = contractBlock(change.contract);
      if (block) return reject(snapshot, block);
      if (change.quantity === 0) return reject(snapshot, "Option quantity is zero.");
      const position: OptionPosition = {
        id: change.id,
        kind: "option",
        accountId: change.accountId,
        quantity: change.quantity,
        averageCost: change.fill.price,
        mark: change.fill.price,
        delta: null,
        gamma: null,
        vegaPerVol: null,
        contract: change.contract,
      };
      const notion = change.quantity * change.fill.price * change.contract.multiplier;
      const settlement = addCalendarDays(change.fill.tradeDate, assumptions.settlementDays);
      let next: Snapshot = { ...snapshot, positions: [...snapshot.positions, position] };
      if (notion > 0) {
        next = { ...next, payables: pushFlow(next.payables, { id: `${change.id}:prem`, accountId: change.accountId, amount: notion, due: settlement, label: "Option premium paid" }) };
      } else {
        next = { ...next, receivables: pushFlow(next.receivables, { id: `${change.id}:prem`, accountId: change.accountId, amount: -notion, due: settlement, label: "Option premium received" }) };
      }
      next = feePayable(next, change.accountId, change.fill.fee, change.fill.tradeDate, change.id);
      return { snapshot: settleDue(stamped(next), change.fill.tradeDate), accepted: true, reason: null };
    }
    case "closeOption": {
      return closeOption(snapshot, change.id, change.positionId, change.quantity, change.fill, assumptions);
    }
    case "roll": {
      const closed = closeOption(snapshot, `${change.id}:close`, change.close.positionId, change.close.quantity, change.close.fill, assumptions);
      if (!closed.accepted) return closed;
      const opened = applyOne(closed.snapshot, {
        op: "openOption",
        id: `${change.id}:open`,
        accountId: change.open.accountId,
        quantity: change.open.quantity,
        contract: change.open.contract,
        fill: change.open.fill,
      }, assumptions);
      if (!opened.accepted) return opened;
      const label = change.timing === "simultaneous" ? "Roll marked simultaneous. Interim funding still uses each settlement date." : "Roll is sequential.";
      return {
        snapshot: stamped({ ...opened.snapshot, residuals: [...opened.snapshot.residuals, { id: `${change.id}:timing`, amount: 0, label }] }),
        accepted: true,
        reason: null,
      };
    }
    case "deposit": {
      if (!(change.amount > 0)) return reject(snapshot, "A deposit amount is positive.");
      const next = addCash(snapshot, change.accountId, change.amount);
      return { snapshot: stamped({ ...next, externalCapital: next.externalCapital + change.amount }), accepted: true, reason: null };
    }
    case "withdraw": {
      if (!(change.amount > 0)) return reject(snapshot, "A withdrawal amount is positive.");
      if (settledCash(snapshot, change.accountId) + 1e-8 < change.amount) return reject(snapshot, "Settled cash in that account is short of the withdrawal.");
      const next = addCash(snapshot, change.accountId, -change.amount);
      return { snapshot: stamped({ ...next, externalCapital: next.externalCapital - change.amount }), accepted: true, reason: null };
    }
    case "borrow": {
      if (!(change.amount > 0)) return reject(snapshot, "A borrow amount is positive.");
      const next = addCash(snapshot, change.accountId, change.amount);
      return {
        snapshot: stamped({
          ...next,
          debt: [...next.debt, { id: change.id, accountId: change.accountId, principal: change.amount, annualRate: change.annualRate }],
        }),
        accepted: true,
        reason: null,
      };
    }
    case "repay": {
      if (!(change.amount > 0)) return reject(snapshot, "A repayment amount is positive.");
      const debt = snapshot.debt.find((row) => row.accountId === change.accountId && row.principal + 1e-8 >= change.amount);
      if (!debt) return reject(snapshot, "Repayment is larger than an existing debt line in that account.");
      if (settledCash(snapshot, change.accountId) + 1e-8 < change.amount) return reject(snapshot, "Settled cash cannot fund the repayment.");
      const next = addCash(snapshot, change.accountId, -change.amount);
      return {
        snapshot: stamped({
          ...next,
          debt: next.debt.map((row) => (row.id === debt.id ? { ...row, principal: row.principal - change.amount } : row)).filter((row) => row.principal > 1e-8),
        }),
        accepted: true,
        reason: null,
      };
    }
    case "transfer": {
      if (!(change.amount > 0)) return reject(snapshot, "A transfer amount is positive.");
      if (change.fromAccountId === change.toAccountId) return reject(snapshot, "A transfer needs two accounts.");
      if (settledCash(snapshot, change.fromAccountId) + 1e-8 < change.amount) return reject(snapshot, "The source account does not have the settled cash.");
      let next = addCash(snapshot, change.fromAccountId, -change.amount);
      next = addCash(next, change.toAccountId, change.amount);
      return { snapshot: stamped(next), accepted: true, reason: null };
    }
    case "setMargin": {
      if (!(change.maintenanceLong >= 0) || !(change.maintenanceLong < 1) || !(change.initialLong >= 0) || !(change.initialLong < 1)) {
        return reject(snapshot, "Margin fractions stay in [0, 1).");
      }
      return {
        snapshot: stamped({ ...snapshot, margin: { maintenanceLong: change.maintenanceLong, initialLong: change.initialLong, provenance: "manual-assumption" } }),
        accepted: true,
        reason: null,
      };
    }
    default:
      return reject(snapshot, "Unsupported change.");
  }
}

function contractBlock(contract: OptionPosition["contract"]): string | null {
  if (!(contract.multiplier > 0) || !(contract.deliverableShares > 0) || !(contract.strike > 0)) return "Contract multiplier, deliverable, or strike is missing.";
  if (contract.exotic) return "Exotic contracts block a complete verdict. They are not dropped from the book.";
  if (contract.adjusted && contract.adjustedMetadata !== "complete") return "An adjusted contract needs complete deliverable metadata before a verdict.";
  if (contract.style !== "american" && contract.style !== "european") return "Exercise style is missing.";
  return null;
}

function closeOption(snapshot: Snapshot, opId: string, positionId: string, quantity: number, fill: Fill, assumptions: Assumptions): ApplyResult {
  if (snapshot.appliedOpIds.includes(opId)) return { snapshot, accepted: true, reason: null };
  const position = snapshot.positions.find((row) => row.id === positionId);
  if (!position || position.kind !== "option") return reject(snapshot, "The option to close is not on the book.");
  if (!(quantity > 0)) return reject(snapshot, "Close quantity is the positive number of contracts.");
  if (quantity > Math.abs(position.quantity) + 1e-8) return reject(snapshot, "A close cannot exceed the open contracts or flip to the other side.");
  const nextQty = position.quantity - Math.sign(position.quantity) * quantity;
  const rest = snapshot.positions.filter((row) => row.id !== position.id);
  const positions = Math.abs(nextQty) < 1e-10 ? rest : [...rest, { ...position, quantity: nextQty, mark: fill.price }];
  const signed = -Math.sign(position.quantity) * quantity;
  const notion = signed * fill.price * position.contract.multiplier;
  const settlement = addCalendarDays(fill.tradeDate, assumptions.settlementDays);
  let next: Snapshot = { ...snapshot, positions };
  if (notion > 0) next = { ...next, payables: pushFlow(next.payables, { id: `${opId}:prem`, accountId: position.accountId, amount: notion, due: settlement, label: "Close premium paid" }) };
  else next = { ...next, receivables: pushFlow(next.receivables, { id: `${opId}:prem`, accountId: position.accountId, amount: -notion, due: settlement, label: "Close premium received" }) };
  const realized = (position.averageCost - fill.price) * Math.sign(position.quantity) * -quantity * position.contract.multiplier;
  next = feePayable(next, position.accountId, fill.fee, fill.tradeDate, opId);
  next = {
    ...next,
    realized: [...next.realized, { id: `${opId}:realized`, amount: realized, label: `Close ${position.contract.underlying} ${position.contract.right}` }],
    appliedOpIds: [...next.appliedOpIds, opId],
  };
  return { snapshot: settleDue(next, fill.tradeDate), accepted: true, reason: null };
}

export function applyChangeSet(baseline: Snapshot, changes: readonly Change[], assumptions: Assumptions = DEFAULT_ASSUMPTIONS): { readonly snapshot: Snapshot; readonly results: readonly ApplyResult[] } {
  const frozen = cloneSnapshot(baseline);
  let current = cloneSnapshot(baseline);
  const results: ApplyResult[] = [];
  for (const change of changes) {
    const applied = applyOne(current, change, assumptions);
    results.push(applied);
    if (applied.accepted) current = applied.snapshot;
  }
  void frozen;
  return { snapshot: current, results };
}

export function snapshotUnchanged(before: Snapshot, after: Snapshot): boolean {
  return JSON.stringify(before) === JSON.stringify(after);
}
