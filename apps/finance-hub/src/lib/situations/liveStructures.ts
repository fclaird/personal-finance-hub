import type { OptionRiskPosition } from "@/lib/alerts/optionRisk";
import { daysBetween, EARNINGS_WINDOW_DAYS, LEAP_MIN_DTE } from "@/lib/strategy/optionParse";
import { detectOptionStructure, isButterflyStructure, type OptionLegView } from "@/lib/strategy/optionStructures";
import type { StrategyTabSlug } from "@/lib/strategy/strategyCategories";

export type LiveStructureKind =
  | "short-strangle"
  | "butterfly"
  | "spread"
  | "naked-call"
  | "covered-call"
  | "short-put"
  | "long-call"
  | "long-put"
  | "leap"
  | "earnings";

/** Option Strategies tabs that render the PnL risk graphic for live books. */
export const LIVE_RISK_CHART_TABS: StrategyTabSlug[] = [
  "all",
  "short-strangles",
  "butterflies",
  "spreads",
  "options-sales",
  "naked-calls",
  "covered-calls",
  "earnings",
  "leaps",
  "long-calls",
  "long-puts",
];

export function strategyTabShowsLiveRiskChart(tab: StrategyTabSlug): boolean {
  return LIVE_RISK_CHART_TABS.includes(tab);
}

export type EarningsNearRow = { symbol: string; earnings_date: string };

export type LiveStructureBook = {
  key: string;
  kind: LiveStructureKind;
  accountId: string;
  accountName: string;
  underlying: string;
  expiration: string | null;
  dte: number | null;
  legs: OptionRiskPosition[];
};

function toLegView(p: OptionRiskPosition): OptionLegView {
  return {
    right: p.right,
    strike: p.strike,
    expiration: p.expiration,
    instruction: p.quantity < 0 ? "sell_open" : p.quantity > 0 ? "buy_open" : "unknown",
    opening: true,
    quantity: Math.abs(p.quantity),
  };
}

function minDte(legs: OptionRiskPosition[]): number | null {
  const dtes = legs.map((l) => l.dte).filter((d): d is number => d != null && Number.isFinite(d));
  return dtes.length ? Math.min(...dtes) : null;
}

function bucketKey(p: OptionRiskPosition, kind: LiveStructureKind): string {
  if (kind === "butterfly") return `${p.accountId}|${p.underlying}|${p.expiration ?? "?"}`;
  return `${p.accountId}|${p.underlying}`;
}

function detectedKind(legs: OptionRiskPosition[], want: LiveStructureKind): LiveStructureKind | null {
  const views = legs.map(toLegView);
  if (want === "butterfly") return isButterflyStructure(views) ? "butterfly" : null;
  if (detectOptionStructure(views) === "short-strangle") return "short-strangle";
  if (legs.some((l) => l.flags.structure === "short-strangle")) return "short-strangle";
  return null;
}

function classifySingleLiveKind(p: OptionRiskPosition): LiveStructureKind | null {
  if (p.flags.structure === "naked-call") return "naked-call";
  if (p.flags.structure === "covered-call") return "covered-call";
  if (p.flags.structure === "naked-put") return "short-put";
  if (p.quantity > 0 && p.right === "C") {
    return p.dte != null && p.dte >= LEAP_MIN_DTE ? "leap" : "long-call";
  }
  if (p.quantity > 0 && p.right === "P") {
    return p.dte != null && p.dte >= LEAP_MIN_DTE ? "leap" : "long-put";
  }
  return null;
}

function tabMatchesKind(tab: StrategyTabSlug, kind: LiveStructureKind): boolean {
  if (tab === "all") return true;
  if (tab === "short-strangles") return kind === "short-strangle";
  if (tab === "butterflies") return kind === "butterfly";
  if (tab === "spreads") return kind === "spread";
  if (tab === "naked-calls") return kind === "naked-call";
  if (tab === "covered-calls") return kind === "covered-call";
  if (tab === "options-sales") return kind === "short-put";
  if (tab === "long-calls") return kind === "long-call";
  if (tab === "long-puts") return kind === "long-put";
  if (tab === "leaps") return kind === "leap";
  if (tab === "earnings") return kind === "earnings";
  return false;
}

export function expirationNearEarningsDate(
  expiration: string | null | undefined,
  earningsDate: string,
  windowDays = EARNINGS_WINDOW_DAYS,
): boolean {
  if (!expiration) return false;
  const d = daysBetween(expiration, earningsDate);
  return d != null && d <= windowDays;
}

function positionNearEarnings(p: OptionRiskPosition, rows: EarningsNearRow[]): boolean {
  const u = p.underlying.toUpperCase();
  return rows.some(
    (r) => r.symbol.toUpperCase() === u && expirationNearEarningsDate(p.expiration, r.earnings_date),
  );
}

function makeBook(kind: LiveStructureKind, legs: OptionRiskPosition[]): LiveStructureBook {
  const first = legs[0]!;
  const expirations = [...new Set(legs.map((l) => l.expiration).filter((x): x is string => !!x))];
  const key =
    kind === "short-strangle"
      ? `${first.accountId}|${first.underlying}`
      : `${first.accountId}|${first.underlying}|${first.expiration ?? "?"}|${kind}`;
  return {
    key,
    kind,
    accountId: first.accountId,
    accountName: first.accountName,
    underlying: first.underlying,
    expiration: expirations[0] ?? null,
    dte: minDte(legs),
    legs: legs
      .slice()
      .sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0) || (a.right ?? "").localeCompare(b.right ?? "")),
  };
}

/** Group live snapshot shorts into strangle / butterfly books (analytics only). */
export function groupLiveStructureBooks(
  positions: OptionRiskPosition[],
  kind: LiveStructureKind,
): LiveStructureBook[] {
  const options = positions.filter((p) => Math.abs(p.quantity) > 1e-9 && p.right);
  const buckets = new Map<string, OptionRiskPosition[]>();
  for (const p of options) {
    const key = bucketKey(p, kind);
    const arr = buckets.get(key) ?? [];
    arr.push(p);
    buckets.set(key, arr);
  }

  const out: LiveStructureBook[] = [];
  for (const [key, legs] of buckets) {
    if (detectedKind(legs, kind) !== kind) continue;
    const first = legs[0]!;
    const expirations = [...new Set(legs.map((l) => l.expiration).filter((x): x is string => !!x))];
    out.push({
      key,
      kind,
      accountId: first.accountId,
      accountName: first.accountName,
      underlying: first.underlying,
      expiration: expirations[0] ?? null,
      dte: minDte(legs),
      legs: legs.slice().sort((a, b) => (a.strike ?? 0) - (b.strike ?? 0) || (a.right ?? "").localeCompare(b.right ?? "")),
    });
  }
  return out.sort((a, b) => a.underlying.localeCompare(b.underlying) || a.accountName.localeCompare(b.accountName));
}

/**
 * Live option books for an Option Strategies tab (graphic only).
 * Strangles / butterflies keep their existing grouping; other tabs get remaining
 * singles / spreads. Earnings uses the calendar rows passed from the page.
 */
export function groupLiveBooksForTab(
  positions: OptionRiskPosition[],
  tab: StrategyTabSlug,
  extras?: { earningsNear?: EarningsNearRow[] },
): LiveStructureBook[] {
  if (!strategyTabShowsLiveRiskChart(tab)) return [];

  if (tab === "short-strangles") return groupLiveStructureBooks(positions, "short-strangle");
  if (tab === "butterflies") return groupLiveStructureBooks(positions, "butterfly");

  if (tab === "earnings") {
    const rows = extras?.earningsNear ?? [];
    const near = optionPositions(positions).filter((p) => p.quantity < 0 && positionNearEarnings(p, rows));
    const buckets = new Map<string, OptionRiskPosition[]>();
    for (const p of near) {
      const key = `${p.accountId}|${p.underlying}|${p.expiration ?? "?"}`;
      const arr = buckets.get(key) ?? [];
      arr.push(p);
      buckets.set(key, arr);
    }
    const out: LiveStructureBook[] = [];
    for (const legs of buckets.values()) {
      out.push(makeBook("earnings", legs));
    }
    return out.sort((a, b) => a.underlying.localeCompare(b.underlying) || a.accountName.localeCompare(b.accountName));
  }

  const used = new Set<string>();
  const out: LiveStructureBook[] = [];

  const take = (books: LiveStructureBook[]) => {
    for (const b of books) {
      if (!tabMatchesKind(tab, b.kind)) continue;
      out.push(b);
      for (const l of b.legs) used.add(l.positionId);
    }
  };

  take(groupLiveStructureBooks(positions, "short-strangle"));
  take(
    groupLiveStructureBooks(
      positions.filter((p) => !used.has(p.positionId)),
      "butterfly",
    ),
  );

  const leftover = optionPositions(positions).filter((p) => !used.has(p.positionId));
  const buckets = new Map<string, OptionRiskPosition[]>();
  for (const p of leftover) {
    const key = `${p.accountId}|${p.underlying}|${p.expiration ?? "?"}`;
    const arr = buckets.get(key) ?? [];
    arr.push(p);
    buckets.set(key, arr);
  }
  for (const legs of buckets.values()) {
    const views = legs.map(toLegView);
    const detected = detectOptionStructure(views);
    if (detected === "spread" || detected === "long-strangle") {
      const book = makeBook("spread", legs);
      if (tabMatchesKind(tab, book.kind)) out.push(book);
      continue;
    }
    const byKind = new Map<LiveStructureKind, OptionRiskPosition[]>();
    for (const p of legs) {
      const k = classifySingleLiveKind(p);
      if (!k) continue;
      const arr = byKind.get(k) ?? [];
      arr.push(p);
      byKind.set(k, arr);
    }
    for (const [kind, kindLegs] of byKind) {
      const book = makeBook(kind, kindLegs);
      if (tabMatchesKind(tab, book.kind)) out.push(book);
    }
  }

  return out.sort((a, b) => a.underlying.localeCompare(b.underlying) || a.accountName.localeCompare(b.accountName));
}

function optionPositions(positions: OptionRiskPosition[]): OptionRiskPosition[] {
  return positions.filter((p) => Math.abs(p.quantity) > 1e-9 && p.right);
}

export function liveBookLinkedToOpenSituation(
  book: LiveStructureBook,
  situations: Array<{ accountId: string; underlying: string; kind: string; status: string; linkStatus: string }>,
): boolean {
  return situations.some(
    (s) =>
      s.linkStatus !== "rejected" &&
      s.status === "open" &&
      s.accountId === book.accountId &&
      s.underlying.toUpperCase() === book.underlying.toUpperCase() &&
      ((book.kind === "short-strangle" && s.kind === "short-strangle") ||
        (book.kind === "butterfly" && s.kind === "butterfly")),
  );
}
