import type { OptionRiskPosition } from "@/lib/alerts/optionRisk";
import { detectOptionStructure, isButterflyStructure, type OptionLegView } from "@/lib/strategy/optionStructures";

export type LiveStructureKind = "short-strangle" | "butterfly";

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
      (book.kind === "short-strangle" ? s.kind === "short-strangle" : s.kind === "butterfly"),
  );
}
