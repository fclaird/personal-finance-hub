import { daysBetween, isCloseInstruction, isShortPremiumInstruction, LEAP_MIN_DTE, optionDte } from "@/lib/strategy/optionParse";
import { detectOptionStructure } from "@/lib/strategy/optionStructures";
import type {
  LinkableLeg,
  LinkableTxn,
  ProposedSituation,
  SituationKind,
  SituationMember,
  SituationMemberRole,
} from "@/lib/situations/types";

const STRANGLE_DATE_WINDOW_DAYS = 2;
const STRANGLE_EXP_WINDOW_DAYS = 7;
const ATTACH_WINDOW_DAYS = 45;

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function optionLegsOf(txn: LinkableTxn): LinkableLeg[] {
  return txn.legs.filter((l) => l.right != null || l.expiration != null || l.symbol);
}

function primaryUnderlying(txn: LinkableTxn): string {
  const und = optionLegsOf(txn).find((l) => l.underlying)?.underlying;
  return (und ?? "").trim().toUpperCase();
}

function netOf(txns: LinkableTxn[], ids: string[]): number | null {
  let sum = 0;
  let any = false;
  const set = new Set(ids);
  for (const t of txns) {
    if (!set.has(t.id)) continue;
    if (t.netAmount != null && Number.isFinite(t.netAmount)) {
      sum += t.netAmount;
      any = true;
    }
  }
  return any ? sum : null;
}

function kindFromSingle(leg: LinkableLeg, tradeDate: string, coveredCall: boolean): SituationKind {
  if (leg.opening && isShortPremiumInstruction(leg.instruction) && leg.right === "C") {
    return coveredCall ? "covered-call" : "short-call";
  }
  if (leg.opening && isShortPremiumInstruction(leg.instruction) && leg.right === "P") return "short-put";
  const dte = optionDte(tradeDate, leg.expiration);
  if (leg.opening && leg.instruction === "buy_open" && dte != null && dte >= LEAP_MIN_DTE) return "leap";
  if (leg.opening && leg.instruction === "buy_open") return "long-option";
  return "other";
}

function titleFor(kind: SituationKind, underlying: string): string {
  switch (kind) {
    case "short-strangle":
      return `${underlying} short strangle`;
    case "short-put":
      return `${underlying} short put`;
    case "short-call":
      return `${underlying} naked short call`;
    case "covered-call":
      return `${underlying} covered call`;
    case "butterfly":
      return `${underlying} butterfly`;
    case "spread":
      return `${underlying} spread`;
    case "leap":
      return `${underlying} LEAP`;
    case "long-option":
      return `${underlying} long option`;
    default:
      return `${underlying} option situation`;
  }
}

function buildSituation(
  txns: LinkableTxn[],
  params: {
    accountId: string;
    underlying: string;
    kind: SituationKind;
    linkStatus: "auto" | "proposed";
    members: SituationMember[];
    openedOn: string;
    closedOn: string | null;
    status: "open" | "closed";
  },
): ProposedSituation {
  return {
    ...params,
    title: titleFor(params.kind, params.underlying),
    netPremium: netOf(txns, params.members.map((m) => m.transactionId)),
  };
}

function similarQty(a: number | null, b: number | null): boolean {
  const qa = Math.abs(a ?? 1);
  const qb = Math.abs(b ?? 1);
  return Math.abs(qa - qb) <= 1;
}

function isRejectedPair(rejected: Set<string>, a: string, b: string): boolean {
  return rejected.has(pairKey(a, b));
}

/**
 * N-transaction linker: same-activity multi-leg, near-day short strangles,
 * then attach rolls/closes to the open short-premium book.
 */
export function proposeSituations(
  txns: LinkableTxn[],
  opts?: { rejectedPairs?: Array<[string, string]>; coveredCallTxnIds?: Set<string> },
): ProposedSituation[] {
  const rejected = new Set((opts?.rejectedPairs ?? []).map(([a, b]) => pairKey(a, b)));
  const covered = opts?.coveredCallTxnIds ?? new Set<string>();
  const sorted = [...txns].sort((a, b) => a.tradeDate.localeCompare(b.tradeDate) || a.id.localeCompare(b.id));
  const used = new Set<string>();
  const out: ProposedSituation[] = [];

  for (const txn of sorted) {
    if (used.has(txn.id)) continue;
    const legs = optionLegsOf(txn);
    if (legs.length < 2) continue;
    const und = primaryUnderlying(txn);
    if (!und) continue;
    const structure = detectOptionStructure(legs);
    let kind: SituationKind = "other";
    if (structure === "butterfly") kind = "butterfly";
    else if (structure === "short-strangle") kind = "short-strangle";
    else if (structure === "spread" || structure === "long-strangle") kind = "spread";
    else kind = "other";
    const openingShorts = legs.filter((l) => l.opening && isShortPremiumInstruction(l.instruction));
    const status = openingShorts.length > 0 ? "open" : "closed";
    out.push(
      buildSituation(sorted, {
        accountId: txn.accountId,
        underlying: und,
        kind,
        linkStatus: "auto",
        members: [{ transactionId: txn.id, role: "open" }],
        openedOn: txn.tradeDate,
        closedOn: status === "closed" ? txn.tradeDate : null,
        status,
      }),
    );
    used.add(txn.id);
  }

  const remaining = sorted.filter((t) => !used.has(t.id) && optionLegsOf(t).length > 0);

  // Cross-transaction short strangles (same account + underlying, near dates).
  for (let i = 0; i < remaining.length; i++) {
    const a = remaining[i]!;
    if (used.has(a.id)) continue;
    const aLeg = optionLegsOf(a)[0];
    if (!aLeg?.opening || !isShortPremiumInstruction(aLeg.instruction) || !aLeg.right) continue;
    for (let j = i + 1; j < remaining.length; j++) {
      const b = remaining[j]!;
      if (used.has(b.id)) continue;
      if (b.accountId !== a.accountId) continue;
      const bLeg = optionLegsOf(b)[0];
      if (!bLeg?.opening || !isShortPremiumInstruction(bLeg.instruction) || !bLeg.right) continue;
      if (primaryUnderlying(a) !== primaryUnderlying(b)) continue;
      if (aLeg.right === bLeg.right) continue;
      if (isRejectedPair(rejected, a.id, b.id)) continue;
      const dateGap = daysBetween(a.tradeDate, b.tradeDate);
      if (dateGap == null || dateGap > STRANGLE_DATE_WINDOW_DAYS) continue;
      const expGap =
        aLeg.expiration && bLeg.expiration ? daysBetween(aLeg.expiration, bLeg.expiration) : null;
      if (expGap == null || expGap > STRANGLE_EXP_WINDOW_DAYS) continue;
      if (!similarQty(aLeg.quantity, bLeg.quantity)) continue;
      const linkStatus = dateGap === 0 && expGap === 0 ? "auto" : "proposed";
      const openedOn = a.tradeDate <= b.tradeDate ? a.tradeDate : b.tradeDate;
      out.push(
        buildSituation(sorted, {
          accountId: a.accountId,
          underlying: primaryUnderlying(a),
          kind: "short-strangle",
          linkStatus,
          members: [
            { transactionId: a.id, role: "open" },
            { transactionId: b.id, role: "open" },
          ],
          openedOn,
          closedOn: null,
          status: "open",
        }),
      );
      used.add(a.id);
      used.add(b.id);
      break;
    }
  }

  type OpenBook = {
    index: number;
    accountId: string;
    underlying: string;
    rights: Set<"C" | "P">;
    lastDate: string;
    remaining: number;
  };

  const books: OpenBook[] = [];
  for (let i = 0; i < out.length; i++) {
    const s = out[i]!;
    if (s.status !== "open") continue;
    const rights = new Set<"C" | "P">();
    let remainingQty = 0;
    for (const m of s.members) {
      const t = sorted.find((x) => x.id === m.transactionId);
      if (!t) continue;
      for (const leg of optionLegsOf(t)) {
        if (leg.right) rights.add(leg.right);
        if (leg.opening && isShortPremiumInstruction(leg.instruction)) remainingQty += Math.abs(leg.quantity ?? 1);
      }
    }
    books.push({
      index: i,
      accountId: s.accountId,
      underlying: s.underlying,
      rights,
      lastDate: s.openedOn,
      remaining: remainingQty || 1,
    });
  }

  function findBook(txn: LinkableTxn, right: "C" | "P" | null): OpenBook | null {
    const und = primaryUnderlying(txn);
    let best: OpenBook | null = null;
    let bestGap = Infinity;
    for (const book of books) {
      if (book.accountId !== txn.accountId || book.underlying !== und) continue;
      if (book.remaining <= 0) continue;
      if (right && book.rights.size > 0 && !book.rights.has(right)) continue;
      const gap = daysBetween(book.lastDate, txn.tradeDate);
      if (gap == null || gap > ATTACH_WINDOW_DAYS) continue;
      if (txn.tradeDate < out[book.index]!.openedOn) continue;
      if (gap < bestGap) {
        best = book;
        bestGap = gap;
      }
    }
    return best;
  }

  const leftover = sorted.filter((t) => !used.has(t.id) && optionLegsOf(t).length > 0);

  // Opens first so later closes/rolls have a book to attach to.
  for (const txn of leftover) {
    if (used.has(txn.id)) continue;
    const leg = optionLegsOf(txn)[0];
    if (!leg) continue;
    if (!(leg.opening && (isShortPremiumInstruction(leg.instruction) || leg.instruction === "buy_open"))) continue;
    if (isShortPremiumInstruction(leg.instruction)) {
      const sameDayClose = leftover.find((other) => {
        if (other.id === txn.id || used.has(other.id)) return false;
        if (other.accountId !== txn.accountId || other.tradeDate !== txn.tradeDate) return false;
        if (primaryUnderlying(other) !== primaryUnderlying(txn)) return false;
        const oLeg = optionLegsOf(other)[0];
        return Boolean(oLeg && isCloseInstruction(oLeg.instruction));
      });
      const closeLeg = sameDayClose ? optionLegsOf(sameDayClose)[0] : null;
      if (sameDayClose && closeLeg && findBook(sameDayClose, closeLeg.right)) {
        continue;
      }
    }
    const und = primaryUnderlying(txn);
    if (!und) continue;
    const kind = kindFromSingle(leg, txn.tradeDate, covered.has(txn.id) && leg.right === "C");
    const sit = buildSituation(sorted, {
      accountId: txn.accountId,
      underlying: und,
      kind,
      linkStatus: "auto",
      members: [{ transactionId: txn.id, role: "open" }],
      openedOn: txn.tradeDate,
      closedOn: null,
      status: "open",
    });
    out.push(sit);
    used.add(txn.id);
    books.push({
      index: out.length - 1,
      accountId: txn.accountId,
      underlying: und,
      rights: new Set(leg.right ? [leg.right] : []),
      lastDate: txn.tradeDate,
      remaining: Math.abs(leg.quantity ?? 1),
    });
  }

  // Pair same-day close+open as a roll onto an existing book, else attach closes.
  const still = sorted.filter((t) => !used.has(t.id) && optionLegsOf(t).length > 0);
  const rollPaired = new Set<string>();

  for (let i = 0; i < still.length; i++) {
    const a = still[i]!;
    if (used.has(a.id) || rollPaired.has(a.id)) continue;
    const aLeg = optionLegsOf(a)[0];
    if (!aLeg) continue;
    for (let j = i + 1; j < still.length; j++) {
      const b = still[j]!;
      if (used.has(b.id) || rollPaired.has(b.id)) continue;
      if (a.accountId !== b.accountId || a.tradeDate !== b.tradeDate) continue;
      if (primaryUnderlying(a) !== primaryUnderlying(b)) continue;
      const bLeg = optionLegsOf(b)[0];
      if (!bLeg) continue;
      const aClose = isCloseInstruction(aLeg.instruction);
      const bClose = isCloseInstruction(bLeg.instruction);
      const aOpen = aLeg.opening && isShortPremiumInstruction(aLeg.instruction);
      const bOpen = bLeg.opening && isShortPremiumInstruction(bLeg.instruction);
      if (!((aClose && bOpen) || (bClose && aOpen))) continue;
      if (isRejectedPair(rejected, a.id, b.id)) continue;
      const closeTxn = aClose ? a : b;
      const openTxn = aOpen ? a : b;
      const closeLeg = optionLegsOf(closeTxn)[0]!;
      const book = findBook(closeTxn, closeLeg.right);
      if (!book) continue;
      out[book.index]!.members.push(
        { transactionId: closeTxn.id, role: "roll_close" },
        { transactionId: openTxn.id, role: "roll_open" },
      );
      out[book.index]!.netPremium = netOf(
        sorted,
        out[book.index]!.members.map((m) => m.transactionId),
      );
      book.lastDate = a.tradeDate;
      const openLeg = optionLegsOf(openTxn)[0];
      if (openLeg?.right) book.rights.add(openLeg.right);
      used.add(a.id);
      used.add(b.id);
      rollPaired.add(a.id);
      rollPaired.add(b.id);
      break;
    }
  }

  for (const txn of sorted) {
    if (used.has(txn.id)) continue;
    const leg = optionLegsOf(txn)[0];
    if (!leg || !isCloseInstruction(leg.instruction)) continue;
    const book = findBook(txn, leg.right);
    if (!book) continue;
    if (isRejectedAgainstBook(rejected, out[book.index]!.members, txn.id)) continue;
    out[book.index]!.members.push({ transactionId: txn.id, role: "close" });
    out[book.index]!.netPremium = netOf(
      sorted,
      out[book.index]!.members.map((m) => m.transactionId),
    );
    book.remaining -= Math.abs(leg.quantity ?? 1);
    book.lastDate = txn.tradeDate;
    if (book.remaining <= 0) {
      out[book.index]!.status = "closed";
      out[book.index]!.closedOn = txn.tradeDate;
    }
    used.add(txn.id);
  }

  return out;
}

function isRejectedAgainstBook(rejected: Set<string>, members: SituationMember[], txnId: string): boolean {
  return members.some((m) => rejected.has(pairKey(m.transactionId, txnId)));
}
