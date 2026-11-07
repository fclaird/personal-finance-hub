import type { MarketNode, Snapshot } from "@/lib/fortress/types";

export type BreachStatus = "breach" | "already-deficient" | "no-breach-tested" | "unknown";

export type MarginPoint = {
  readonly nodeId: string;
  readonly date: string;
  readonly spotFactor: number;
  readonly gross: number;
  readonly equity: number;
  readonly requirement: number;
  readonly excess: number | null;
  readonly houseHike: number;
  readonly status: "known" | "unknown";
  readonly reason: string | null;
};

/**
 * Long-stock maintenance. Eligible equity is market value minus the debit.
 * Requirement is maintenance times market value. No second haircut.
 * Critical value is D / (1 − m). This is the stock fixture, not a mixed-option formula.
 */
export function longStockExcess(marketValue: number, debit: number, maintenance: number): number | null {
  if (!Number.isFinite(marketValue) || !Number.isFinite(debit) || !Number.isFinite(maintenance)) return null;
  if (!(maintenance >= 0) || !(maintenance < 1)) return null;
  return marketValue - debit - maintenance * marketValue;
}

export function criticalLongValue(debit: number, maintenance: number): number | null {
  if (!(debit >= 0) || !(maintenance >= 0) || !(maintenance < 1)) return null;
  return debit / (1 - maintenance);
}

export function declineToCritical(startValue: number, debit: number, maintenance: number): number | null {
  const critical = criticalLongValue(debit, maintenance);
  if (critical == null || !(startValue > 0)) return null;
  return 1 - critical / startValue;
}

export function marginPoints(
  nodes: readonly MarketNode[],
  startValue: number,
  debit: number,
  maintenance: number,
): MarginPoint[] {
  return nodes.map((node) => {
    const gross = startValue * node.spotFactor;
    const applied = maintenance + node.houseHike;
    const excess = longStockExcess(gross, debit, applied);
    if (excess == null) {
      return { nodeId: node.id, date: node.date, spotFactor: node.spotFactor, gross, equity: gross - debit, requirement: Number.NaN, excess: null, houseHike: node.houseHike, status: "unknown", reason: "Maintenance fraction is outside [0, 1)." };
    }
    return {
      nodeId: node.id,
      date: node.date,
      spotFactor: node.spotFactor,
      gross,
      equity: gross - debit,
      requirement: applied * gross,
      excess,
      houseHike: node.houseHike,
      status: "known",
      reason: null,
    };
  });
}

export type FirstBreach = {
  readonly status: BreachStatus;
  readonly nodeId: string | null;
  readonly date: string | null;
  readonly interval: readonly [number, number] | null;
  readonly refinedFactor: number | null;
  readonly evidence: string;
};

/** Scan every node. Do not assume the path is monotone. Bisect only the first crossing interval. */
export function firstMaintenanceBreach(points: readonly MarginPoint[], maintenance: number, debit: number, startValue: number): FirstBreach {
  if (points.some((point) => point.status === "unknown" || point.excess == null)) {
    return { status: "unknown", nodeId: null, date: null, interval: null, refinedFactor: null, evidence: "A node is missing a maintenance excess." };
  }
  const first = points[0];
  if (!first) return { status: "unknown", nodeId: null, date: null, interval: null, refinedFactor: null, evidence: "The path has no nodes." };
  if ((first.excess ?? 0) < 0) {
    return { status: "already-deficient", nodeId: first.nodeId, date: first.date, interval: null, refinedFactor: first.spotFactor, evidence: "Maintenance excess is already negative at the first node." };
  }
  for (let i = 1; i < points.length; i++) {
    const prev = points[i - 1]!;
    const point = points[i]!;
    if ((prev.excess ?? 0) >= 0 && (point.excess ?? 0) < 0) {
      const refined = bisectFactor(prev.spotFactor, point.spotFactor, startValue, debit, maintenance + point.houseHike);
      return {
        status: "breach",
        nodeId: point.nodeId,
        date: point.date,
        interval: [prev.spotFactor, point.spotFactor],
        refinedFactor: refined,
        evidence: `Excess changes sign between spot factors ${prev.spotFactor} and ${point.spotFactor}. Later recovery does not clear this breach.`,
      };
    }
  }
  return { status: "no-breach-tested", nodeId: null, date: null, interval: null, refinedFactor: null, evidence: "Every tested node has non-negative maintenance excess." };
}

function bisectFactor(passFactor: number, failFactor: number, startValue: number, debit: number, maintenance: number): number {
  let pass = passFactor;
  let fail = failFactor;
  for (let i = 0; i < 40; i++) {
    const mid = (pass + fail) / 2;
    const excess = longStockExcess(startValue * mid, debit, maintenance);
    if (excess == null) return mid;
    if (excess >= 0) pass = mid;
    else fail = mid;
  }
  return (pass + fail) / 2;
}

export function stockGross(snapshot: Snapshot, spot: number, symbol: string): number {
  return snapshot.positions.reduce((sum, position) => {
    if (position.kind === "option" || position.symbol !== symbol) return sum;
    return sum + position.quantity * spot;
  }, 0);
}
