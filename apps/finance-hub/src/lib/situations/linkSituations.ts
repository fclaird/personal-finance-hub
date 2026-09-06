import { daysBetween, isCloseInstruction, isShortPremiumInstruction, LEAP_MIN_DTE, optionDte } from "@/lib/strategy/optionParse";
import { detectOptionStructure, isButterflyStructure } from "@/lib/strategy/optionStructures";
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

  // Same-day cross-fill butterflies (Schwab often splits 1-2-1 across separate TRADE rows).
  {
    const leftoverForFly = sorted.filter((t) => !used.has(t.id) && optionLegsOf(t).length > 0);
    const byBucket = new Map<string, LinkableTxn[]>();
    for (const t of leftoverForFly) {
      const leg = optionLegsOf(t)[0];
      if (!leg?.opening) continue;
      const und = primaryUnderlying(t);
      if (!und || !leg.expiration) continue;
      const key = t.accountId + "|" + und + "|" + t.tradeDate + "|" + leg.expiration;
      const arr = byBucket.get(key) ?? [];
      arr.push(t);
      byBucket.set(key, arr);
    }
    for (const [, group] of byBucket) {
      if (group.length < 3) continue;
      if (group.some((t) => used.has(t.id))) continue;
      const legs = group.flatMap((t) => optionLegsOf(t));
      if (!isButterflyStructure(legs)) continue;
      const first = group[0]!;
      out.push(
        buildSituation(sorted, {
          accountId: first.accountId,
          underlying: primaryUnderlying(first),
          kind: "butterfly",
          linkStatus: "auto",
          members: group.map((t) => ({ transactionId: t.id, role: "open" as const })),
          openedOn: first.tradeDate,
          closedOn: null,
          status: legs.some((l) => l.opening && isShortPremiumInstruction(l.instruction)) ? "open" : "closed",
        }),
      );
      for (const t of group) used.add(t.id);
    }
  }

  type OpenBook = {
    index: number;
    accountId: string;
    underlying: string;
    rights: Set<"C" | "P">;
    /** Strike keys like "C:400" / "P:350" still open on this book. */
    openKeys: Set<string>;
    lastDate: string;
    remaining: number;
  };

  function strikeKey(right: "C" | "P" | null, strike: number | null): string | null {
    if (!right || strike == null || !Number.isFinite(strike)) return null;
    return right + ":" + strike;
  }

  function rebuildBookKeys(book: OpenBook): void {
    const rights = new Set<"C" | "P">();
    const openKeys = new Set<string>();
    let remainingQty = 0;
    const sit = out[book.index]!;
    // Net opening shorts minus closes/legs per strike key.
    const qtyByKey = new Map<string, number>();
    for (const m of sit.members) {
      const t = sorted.find((x) => x.id === m.transactionId);
      if (!t) continue;
      for (const leg of optionLegsOf(t)) {
        const key = strikeKey(leg.right, leg.strike);
        if (!key || !leg.right) continue;
        const q = Math.abs(leg.quantity ?? 1);
        if (m.role === "open" || m.role === "roll_open") {
          if (isShortPremiumInstruction(leg.instruction) || leg.instruction === "buy_open") {
            qtyByKey.set(key, (qtyByKey.get(key) ?? 0) + q);
            rights.add(leg.right);
          }
        } else if (m.role === "close" || m.role === "roll_close" || m.role === "leg") {
          qtyByKey.set(key, (qtyByKey.get(key) ?? 0) - q);
        }
      }
    }
    for (const [key, q] of qtyByKey) {
      if (q > 1e-9) {
        openKeys.add(key);
        remainingQty += q;
        const right = key.startsWith("C") ? "C" : "P";
        rights.add(right);
      }
    }
    book.rights = rights;
    book.openKeys = openKeys;
    book.remaining = remainingQty;
  }

  const books: OpenBook[] = [];
  for (let i = 0; i < out.length; i++) {
    const sit = out[i]!;
    if (sit.status !== "open") continue;
    const book: OpenBook = {
      index: i,
      accountId: sit.accountId,
      underlying: sit.underlying,
      rights: new Set(),
      openKeys: new Set(),
      lastDate: sit.openedOn,
      remaining: 0,
    };
    rebuildBookKeys(book);
    if (book.remaining <= 0) book.remaining = 1;
    books.push(book);
  }

  function findBook(txn: LinkableTxn, right: "C" | "P" | null, strike: number | null = null): OpenBook | null {
    const und = primaryUnderlying(txn);
    const key = strikeKey(right, strike);
    let best: OpenBook | null = null;
    let bestScore = Infinity;
    for (const book of books) {
      if (book.accountId !== txn.accountId || book.underlying !== und) continue;
      if (book.remaining <= 0) continue;
      if (txn.tradeDate < out[book.index]!.openedOn) continue;
      const gap = daysBetween(book.lastDate, txn.tradeDate);
      if (gap == null || gap > ATTACH_WINDOW_DAYS) continue;
      // Prefer exact strike match; skip books that don't hold this strike when we know it.
      if (key) {
        if (!book.openKeys.has(key)) continue;
      } else if (right && book.rights.size > 0 && !book.rights.has(right)) {
        continue;
      }
      // Lower score is better: exact key match beats right-only; nearer dates win ties.
      const score = (key && book.openKeys.has(key) ? 0 : 100) + gap;
      if (score < bestScore) {
        best = book;
        bestScore = score;
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
      if (sameDayClose && closeLeg && findBook(sameDayClose, closeLeg.right, closeLeg.strike)) {
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
    const newBook: OpenBook = {
      index: out.length - 1,
      accountId: txn.accountId,
      underlying: und,
      rights: new Set(leg.right ? [leg.right] : []),
      openKeys: new Set(),
      lastDate: txn.tradeDate,
      remaining: Math.abs(leg.quantity ?? 1),
    };
    rebuildBookKeys(newBook);
    books.push(newBook);
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
      const book = findBook(closeTxn, closeLeg.right, closeLeg.strike);
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
      rebuildBookKeys(book);
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
    const book = findBook(txn, leg.right, leg.strike);
    if (!book) continue;
    if (isRejectedAgainstBook(rejected, out[book.index]!.members, txn.id)) continue;
    // Partial wing takeoff on a multi-leg book (e.g. buy back short call, leave short put) = leg out.
    const key = strikeKey(leg.right, leg.strike);
    const otherWingsRemain =
      key != null &&
      [...book.openKeys].some((k) => k !== key) &&
      out[book.index]!.kind === "short-strangle";
    const role = otherWingsRemain ? "leg" : "close";
    out[book.index]!.members.push({ transactionId: txn.id, role });
    out[book.index]!.netPremium = netOf(
      sorted,
      out[book.index]!.members.map((m) => m.transactionId),
    );
    book.lastDate = txn.tradeDate;
    rebuildBookKeys(book);
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
