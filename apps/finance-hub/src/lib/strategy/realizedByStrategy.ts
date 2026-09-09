import { situationRealizedPnl } from "@/lib/situations/adjustmentEconomics";
import type { SituationMemberView } from "@/lib/situations/apiTypes";
import { clumpPartialFills } from "@/lib/situations/clumpPartialFills";

/** Closed option books the Strategies tree already knows how to value. */
export type RealizedBookInput = {
  id: string;
  underlying: string;
  kind: string;
  status: string;
  linkStatus: string;
  closedOn: string | null;
  members: SituationMemberView[];
};

export type RealizedPeriod =
  | { type: "all" }
  | { type: "ytd"; year: number; asOf: string }
  | { type: "year"; year: number };

export type RealizedUnderlyingRow = {
  underlying: string;
  realized: number;
  bookCount: number;
};

export type RealizedStrategyRow = {
  kind: string;
  label: string;
  realized: number;
  bookCount: number;
  underlyings: RealizedUnderlyingRow[];
};

export type RealizedSummary = {
  period: RealizedPeriod;
  years: number[];
  grandTotal: number;
  bookCount: number;
  skippedOpen: number;
  skippedRejected: number;
  skippedNoRealized: number;
  strategies: RealizedStrategyRow[];
};

/** Display order matches Option Strategies structure / short-premium / long tabs. */
export const SITUATION_KIND_ORDER = [
  "short-strangle",
  "butterfly",
  "spread",
  "short-put",
  "short-call",
  "covered-call",
  "leap",
  "long-option",
  "other",
] as const;

export function situationKindLabel(kind: string): string {
  switch (kind) {
    case "short-strangle":
      return "Strangles";
    case "butterfly":
      return "Butterflies";
    case "spread":
      return "Spreads";
    case "short-put":
      return "Short Puts";
    case "short-call":
      return "Naked Calls";
    case "covered-call":
      return "Covered Calls";
    case "leap":
      return "LEAPs";
    case "long-option":
      return "Long options";
    case "other":
      return "Other";
    default:
      return kind.replace(/-/g, " ");
  }
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

function ymd(value: string | null | undefined): string | null {
  if (value == null) return null;
  const s = value.trim().slice(0, 10);
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function yearOf(iso: string): number | null {
  const y = Number(iso.slice(0, 4));
  return Number.isInteger(y) ? y : null;
}

/** Calendar day the book’s realized G/L belongs to: closedOn, else last close fill. */
export function realizedEventDate(book: RealizedBookInput): string | null {
  const closed = ymd(book.closedOn);
  if (closed) return closed;
  const closeDates: string[] = [];
  for (const m of book.members) {
    if (m.role !== "close" && m.role !== "roll_close" && m.role !== "leg") continue;
    const d = ymd(m.tradeDate);
    if (d) closeDates.push(d);
  }
  if (closeDates.length === 0) return null;
  closeDates.sort();
  return closeDates[closeDates.length - 1] ?? null;
}

export function todayYmd(now: Date = new Date()): string {
  const y = now.getFullYear();
  const mo = String(now.getMonth() + 1).padStart(2, "0");
  const d = String(now.getDate()).padStart(2, "0");
  return `${y}-${mo}-${d}`;
}

export function parseRealizedPeriod(raw: string | null | undefined, now: Date = new Date()): RealizedPeriod | null {
  const v = (raw ?? "all").trim().toLowerCase();
  if (v === "" || v === "all" || v === "all-time") return { type: "all" };
  if (v === "ytd" || v === "year-to-date") {
    const asOf = todayYmd(now);
    return { type: "ytd", year: now.getFullYear(), asOf };
  }
  if (/^\d{4}$/.test(v)) {
    const year = Number(v);
    if (year < 1990 || year > 2100) return null;
    return { type: "year", year };
  }
  return null;
}

export function periodInQuery(period: RealizedPeriod): string {
  if (period.type === "all") return "all";
  if (period.type === "ytd") return "ytd";
  return String(period.year);
}

function dateInPeriod(iso: string | null, period: RealizedPeriod): boolean {
  if (period.type === "all") return true;
  if (iso == null) return false;
  if (period.type === "ytd") return iso >= `${period.year}-01-01` && iso <= period.asOf;
  return iso.startsWith(`${period.year}-`);
}

function kindSortKey(kind: string): number {
  const i = (SITUATION_KIND_ORDER as readonly string[]).indexOf(kind);
  return i >= 0 ? i : SITUATION_KIND_ORDER.length;
}

/**
 * FIFO realized on a closed book — same helper as the Strategies tree Realized line
 * (`situationRealizedPnl` after clumping partial fills). Null when no close/roll_close/leg
 * matched an open credit; those books are not counted.
 */
export function closedBookRealized(book: RealizedBookInput): number | null {
  return situationRealizedPnl(clumpPartialFills(book.members));
}

export function aggregateClosedRealized(
  books: RealizedBookInput[],
  period: RealizedPeriod,
): RealizedSummary {
  const years = new Set<number>();
  let skippedOpen = 0;
  let skippedRejected = 0;
  let skippedNoRealized = 0;

  type Acc = { realized: number; bookCount: number; byUnd: Map<string, { realized: number; bookCount: number }> };
  const byKind = new Map<string, Acc>();

  for (const book of books) {
    if (book.linkStatus === "rejected") {
      skippedRejected += 1;
      continue;
    }
    if (book.status !== "closed") {
      skippedOpen += 1;
      continue;
    }

    const eventDate = realizedEventDate(book);
    const y = eventDate ? yearOf(eventDate) : null;
    if (y != null) years.add(y);

    if (!dateInPeriod(eventDate, period)) continue;

    const realized = closedBookRealized(book);
    if (realized == null) {
      skippedNoRealized += 1;
      continue;
    }

    const kind = (book.kind || "other").trim() || "other";
    const und = (book.underlying || "—").trim().toUpperCase() || "—";
    let acc = byKind.get(kind);
    if (!acc) {
      acc = { realized: 0, bookCount: 0, byUnd: new Map() };
      byKind.set(kind, acc);
    }
    acc.realized = round2(acc.realized + realized);
    acc.bookCount += 1;
    const u = acc.byUnd.get(und) ?? { realized: 0, bookCount: 0 };
    u.realized = round2(u.realized + realized);
    u.bookCount += 1;
    acc.byUnd.set(und, u);
  }

  const strategies: RealizedStrategyRow[] = [...byKind.entries()]
    .sort((a, b) => kindSortKey(a[0]) - kindSortKey(b[0]) || a[0].localeCompare(b[0]))
    .map(([kind, acc]) => ({
      kind,
      label: situationKindLabel(kind),
      realized: acc.realized,
      bookCount: acc.bookCount,
      underlyings: [...acc.byUnd.entries()]
        .map(([underlying, u]) => ({ underlying, realized: u.realized, bookCount: u.bookCount }))
        .sort(
          (a, b) =>
            Math.abs(b.realized) - Math.abs(a.realized) || a.underlying.localeCompare(b.underlying),
        ),
    }));

  const grandTotal = round2(strategies.reduce((s, r) => s + r.realized, 0));
  const bookCount = strategies.reduce((s, r) => s + r.bookCount, 0);

  return {
    period,
    years: [...years].sort((a, b) => b - a),
    grandTotal,
    bookCount,
    skippedOpen,
    skippedRejected,
    skippedNoRealized,
    strategies,
  };
}

export function realizedSummaryToCsv(summary: RealizedSummary): string {
  const period = periodInQuery(summary.period);
  const headers = ["period", "strategy", "kind", "underlying", "bookCount", "realized"];
  const esc = (s: string) => `"${s.replace(/"/g, '""')}"`;
  const lines = [headers.join(",")];
  const row = (
    strategy: string,
    kind: string,
    underlying: string,
    bookCount: number,
    realized: number,
  ) =>
    [esc(period), esc(strategy), esc(kind), esc(underlying), bookCount, realized.toFixed(2)].join(",");

  lines.push(row("Grand total", "", "", summary.bookCount, summary.grandTotal));
  for (const s of summary.strategies) {
    lines.push(row(s.label, s.kind, "", s.bookCount, s.realized));
    for (const u of s.underlyings) {
      lines.push(row(s.label, s.kind, u.underlying, u.bookCount, u.realized));
    }
  }
  return lines.join("\n");
}
