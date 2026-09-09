import type { SituationMemberView } from "@/lib/situations/apiTypes";
import { realizedOnClosedLegs } from "@/lib/situations/adjustmentEconomics";
import { parseOptionFromSchwabSymbol } from "@/lib/strategy/optionParse";

export type SituationTreeNode =
  | {
      id: string;
      kind: "open";
      label: string;
      members: SituationMemberView[];
      /** Realized G/L on this step — null for initial open (credits are unrealized). */
      stepNet: number | null;
      /** Open credit: establishing premium still on open lots after this step. */
      cumulativeNet: number | null;
      children: SituationTreeNode[];
    }
  | {
      id: string;
      kind: "adjustment";
      label: string;
      closeMembers: SituationMemberView[];
      openMembers: SituationMemberView[];
      /** Members chronologically before this adjustment (for per-leg realized G/L). */
      priorMembers: SituationMemberView[];
      /** Realized G/L on closed legs only (not roll cash / new open credit). */
      stepNet: number | null;
      /** Realized G/L on closed legs vs original open credits. */
      realizedOnClose: number | null;
      /** Open credit remaining after this adjustment. */
      cumulativeNet: number | null;
      /** Running realized G/L for the whole book after this step. */
      realizedCarry: number | null;
      children: SituationTreeNode[];
    }
  | {
      id: string;
      kind: "close";
      label: string;
      members: SituationMemberView[];
      stepNet: number | null;
      cumulativeNet: number | null;
      realizedCarry: number | null;
      children: SituationTreeNode[];
    }
  | {
      id: string;
      kind: "current";
      label: string;
      symbols: string[];
      /** Live open premium on tip structure (unrealized). */
      cumulativeNet: number | null;
      children: SituationTreeNode[];
    }
  | {
      id: string;
      kind: "leg";
      label: string;
      member: SituationMemberView;
      stepNet: number | null;
      cumulativeNet: number | null;
      realizedCarry: number | null;
      children: SituationTreeNode[];
    };

type CreditLot = {
  symbol: string;
  qtyRemaining: number;
  creditPerContract: number;
};

function absQty(q: number | null | undefined): number {
  return q != null && Number.isFinite(q) ? Math.abs(q) : 0;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function roleRank(role: SituationMemberView["role"]): number {
  switch (role) {
    case "open":
      return 0;
    case "roll_close":
      return 1;
    case "roll_open":
      return 2;
    case "close":
      return 3;
    case "leg":
      return 4;
    default:
      return 5;
  }
}

function sortMembers(members: SituationMemberView[]): SituationMemberView[] {
  return [...members].sort(
    (a, b) =>
      a.tradeDate.localeCompare(b.tradeDate) ||
      roleRank(a.role) - roleRank(b.role) ||
      a.transactionId.localeCompare(b.transactionId),
  );
}

function symbolsOf(members: SituationMemberView[]): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (const m of members) {
    const s = (m.symbol ?? "").trim();
    if (!s || seen.has(s)) continue;
    seen.add(s);
    out.push(s);
  }
  return out;
}

function memberLabel(m: SituationMemberView): string {
  return m.symbol ?? m.transactionId;
}

/** Add establishing credits (open / roll_open) onto the open-lot book. */
function addEstablishingLots(lots: CreditLot[], members: SituationMemberView[]): void {
  for (const m of members) {
    if (m.role !== "open" && m.role !== "roll_open") continue;
    const net = m.netAmount != null && Number.isFinite(m.netAmount) ? m.netAmount : null;
    if (net == null) continue;
    const qty = absQty(m.quantity);
    // Missing qty: treat whole net as a single-contract lot so open credit still tracks.
    const useQty = qty > 0 ? qty : 1;
    lots.push({
      symbol: (m.symbol ?? "").trim(),
      qtyRemaining: useQty,
      creditPerContract: net / useQty,
    });
  }
}

/**
 * Remove closed qty from open lots (FIFO by symbol, then any symbol) —
 * same matching order as adjustmentEconomics.
 */
function consumeClosedLots(lots: CreditLot[], closeMembers: SituationMemberView[]): void {
  for (const close of closeMembers) {
    let qtyLeft = absQty(close.quantity);
    if (qtyLeft <= 0) {
      // No qty on the close: consume all lots matching the symbol (or all if blank).
      const closeSym = (close.symbol ?? "").trim();
      for (const lot of lots) {
        if (closeSym && lot.symbol !== closeSym) continue;
        lot.qtyRemaining = 0;
      }
      continue;
    }
    const closeSym = (close.symbol ?? "").trim();
    const consume = (lot: CreditLot, take: number): number => {
      if (take <= 0 || lot.qtyRemaining <= 0) return 0;
      const used = Math.min(take, lot.qtyRemaining);
      lot.qtyRemaining -= used;
      return used;
    };
    if (closeSym) {
      for (const lot of lots) {
        if (qtyLeft <= 0) break;
        if (lot.symbol !== closeSym || lot.qtyRemaining <= 0) continue;
        qtyLeft -= consume(lot, qtyLeft);
      }
    }
    for (const lot of lots) {
      if (qtyLeft <= 0) break;
      if (lot.qtyRemaining <= 0) continue;
      qtyLeft -= consume(lot, qtyLeft);
    }
  }
  // Drop emptied lots so sums stay clean.
  for (let i = lots.length - 1; i >= 0; i--) {
    if (lots[i]!.qtyRemaining <= 0) lots.splice(i, 1);
  }
}

/** Sum of establishing credits still on open lots (unrealized open premium). */
function openCreditSum(lots: CreditLot[]): number | null {
  if (lots.length === 0) return 0;
  let sum = 0;
  let any = false;
  for (const lot of lots) {
    if (lot.qtyRemaining <= 0) continue;
    sum += lot.creditPerContract * lot.qtyRemaining;
    any = true;
  }
  return any ? round2(sum) : 0;
}

/**
 * Collapse a flat situation member list into a tree:
 * open (root) → adjustment branches (roll_close + roll_open) → close / current tip.
 * Sequential rolls nest so the latest structure sits at the tip.
 *
 * Accounting:
 * - stepNet = realized G/L on that adjustment/close/leg (not roll cash).
 * - cumulativeNet = open credit still on lots open after that step (grey in UI).
 * - realizedCarry = running sum of stepNet after that step (position total, green/red).
 */
export function buildSituationTree(
  members: SituationMemberView[],
  options?: { status?: string },
): SituationTreeNode[] {
  const sorted = sortMembers(members);
  if (sorted.length === 0) return [];

  const opens = sorted.filter((m) => m.role === "open");
  const rest = sorted.filter((m) => m.role !== "open");

  const openLots: CreditLot[] = [];
  addEstablishingLots(openLots, opens);
  const priorForRealize: SituationMemberView[] = [...opens];

  const root: SituationTreeNode = {
    id: `open:${opens.map((m) => m.transactionId).join(",") || "none"}`,
    kind: "open",
    label: opens.length ? `Open · ${opens.map(memberLabel).join(" + ")}` : "Open",
    members: opens,
    // Initial open: credits are unrealized — no realized step.
    stepNet: null,
    cumulativeNet: openCreditSum(openLots),
    children: [],
  };

  let tip: SituationTreeNode = root;
  let sawClose = false;
  let realizedCarry: number | null = null;
  let i = 0;

  const addCarry = (step: number | null): number | null => {
    if (step == null || !Number.isFinite(step)) return realizedCarry;
    realizedCarry = round2((realizedCarry ?? 0) + step);
    return realizedCarry;
  };
  while (i < rest.length) {
    const m = rest[i]!;

    if (m.role === "roll_close") {
      const closeMembers: SituationMemberView[] = [m];
      i += 1;
      while (i < rest.length && rest[i]!.role === "roll_close" && rest[i]!.tradeDate === m.tradeDate) {
        closeMembers.push(rest[i]!);
        i += 1;
      }
      const openMembers: SituationMemberView[] = [];
      while (i < rest.length && rest[i]!.role === "roll_open") {
        // same-day or next open after this close cluster
        if (openMembers.length && rest[i]!.tradeDate !== openMembers[0]!.tradeDate) break;
        openMembers.push(rest[i]!);
        i += 1;
      }
      const realized = realizedOnClosedLegs(closeMembers, priorForRealize);
      consumeClosedLots(openLots, closeMembers);
      // Tag open members as roll_open for lot booking (they already are).
      addEstablishingLots(openLots, openMembers);
      const openCredit = openCreditSum(openLots);
      const node: SituationTreeNode = {
        id: `adj:${closeMembers.map((x) => x.transactionId).join(",")}`,
        kind: "adjustment",
        label: `Adjustment · ${[...closeMembers, ...openMembers].map(memberLabel).join(" → ")}`,
        closeMembers,
        openMembers,
        priorMembers: [...priorForRealize],
        stepNet: realized,
        realizedOnClose: realized,
        cumulativeNet: openCredit,
        realizedCarry: addCarry(realized),
        children: [],
      };
      tip.children.push(node);
      tip = node;
      priorForRealize.push(...closeMembers, ...openMembers);
      continue;
    }

    if (m.role === "roll_open") {
      // orphan roll_open without a close — treat as adjustment open-only
      const openMembers: SituationMemberView[] = [m];
      i += 1;
      while (i < rest.length && rest[i]!.role === "roll_open" && rest[i]!.tradeDate === m.tradeDate) {
        openMembers.push(rest[i]!);
        i += 1;
      }
      addEstablishingLots(openLots, openMembers);
      const node: SituationTreeNode = {
        id: `adj-open:${openMembers.map((x) => x.transactionId).join(",")}`,
        kind: "adjustment",
        label: `Adjustment · ${openMembers.map(memberLabel).join(" + ")}`,
        closeMembers: [],
        openMembers,
        priorMembers: [...priorForRealize],
        // No close → no realized step.
        stepNet: null,
        realizedOnClose: null,
        cumulativeNet: openCreditSum(openLots),
        realizedCarry,
        children: [],
      };
      tip.children.push(node);
      tip = node;
      priorForRealize.push(...openMembers);
      continue;
    }

    if (m.role === "close") {
      const closeMembers: SituationMemberView[] = [m];
      i += 1;
      while (i < rest.length && rest[i]!.role === "close") {
        closeMembers.push(rest[i]!);
        i += 1;
      }
      const realized = realizedOnClosedLegs(closeMembers, priorForRealize);
      consumeClosedLots(openLots, closeMembers);
      tip.children.push({
        id: `close:${closeMembers.map((x) => x.transactionId).join(",")}`,
        kind: "close",
        label: `Close · ${closeMembers.map(memberLabel).join(" + ")}`,
        members: closeMembers,
        stepNet: realized,
        cumulativeNet: openCreditSum(openLots),
        realizedCarry: addCarry(realized),
        children: [],
      });
      priorForRealize.push(...closeMembers);
      sawClose = true;
      continue;
    }

    // leg / unknown — realized on that leg; open credit updates
    const realized = realizedOnClosedLegs([m], priorForRealize);
    consumeClosedLots(openLots, [m]);
    tip.children.push({
      id: `leg:${m.transactionId}`,
      kind: "leg",
      label: `Leg · ${memberLabel(m)}`,
      member: m,
      stepNet: realized,
      cumulativeNet: openCreditSum(openLots),
      realizedCarry: addCarry(realized),
      children: [],
    });
    priorForRealize.push(m);
    i += 1;
  }

  if ((options?.status ?? "open") === "open") {
    // Current tip: start from initial opens; each adjustment replaces closed wings only
    // (put-only roll keeps the call wing, etc.).
    let currentSymbols: string[] = symbolsOf(opens);
    const walk = (n: SituationTreeNode) => {
      if (n.kind === "adjustment") {
        const closedSyms = new Set(symbolsOf(n.closeMembers));
        currentSymbols = currentSymbols.filter((s) => !closedSyms.has(s));
        for (const c of n.closeMembers) {
          const parsed = parseOptionFromSchwabSymbol(c.symbol);
          if (!parsed?.right) continue;
          currentSymbols = currentSymbols.filter((s) => {
            const p = parseOptionFromSchwabSymbol(s);
            return p?.right !== parsed.right;
          });
        }
        for (const s of symbolsOf(n.openMembers)) {
          if (!currentSymbols.includes(s)) currentSymbols.push(s);
        }
      } else if (n.kind === "leg") {
        const sym = (n.member.symbol ?? "").trim();
        if (sym) currentSymbols = currentSymbols.filter((s) => s !== sym);
        const parsed = parseOptionFromSchwabSymbol(n.member.symbol);
        if (parsed?.right) {
          currentSymbols = currentSymbols.filter((s) => {
            const p = parseOptionFromSchwabSymbol(s);
            return p?.right !== parsed.right;
          });
        }
      }
      for (const c of n.children) walk(c);
    };
    walk(root);
    if (!sawClose) {
      tip.children.push({
        id: `current:${currentSymbols.join(",")}`,
        kind: "current",
        label:
          currentSymbols.length > 0
            ? `Current · ${currentSymbols.join(" + ")}`
            : "Current · still open",
        symbols: currentSymbols,
        cumulativeNet: openCreditSum(openLots),
        children: [],
      });
    }
  }

  return [root];
}

/** Right-column figures for one tree block. UI stacks: open credit, fills, realized, total. */
export function situationBlockFigures(node: SituationTreeNode): {
  openCredit: number | null;
  realized: number | null;
  total: number | null;
  showRealizedStep: boolean;
} {
  const showRealizedStep =
    node.kind === "close" ||
    node.kind === "leg" ||
    (node.kind === "adjustment" && node.closeMembers.length > 0);
  return {
    openCredit: node.cumulativeNet,
    realized: "stepNet" in node ? node.stepNet : null,
    total: "realizedCarry" in node ? node.realizedCarry : null,
    showRealizedStep,
  };
}
