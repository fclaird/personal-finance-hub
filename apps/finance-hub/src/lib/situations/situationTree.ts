import type { SituationMemberView } from "@/lib/situations/apiTypes";

export type SituationTreeNode =
  | {
      id: string;
      kind: "open";
      label: string;
      members: SituationMemberView[];
      stepNet: number | null;
      cumulativeNet: number | null;
      children: SituationTreeNode[];
    }
  | {
      id: string;
      kind: "adjustment";
      label: string;
      closeMembers: SituationMemberView[];
      openMembers: SituationMemberView[];
      stepNet: number | null;
      cumulativeNet: number | null;
      children: SituationTreeNode[];
    }
  | {
      id: string;
      kind: "close";
      label: string;
      members: SituationMemberView[];
      stepNet: number | null;
      cumulativeNet: number | null;
      children: SituationTreeNode[];
    }
  | {
      id: string;
      kind: "current";
      label: string;
      symbols: string[];
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
      children: SituationTreeNode[];
    };

function sumNets(members: SituationMemberView[]): number | null {
  let sum = 0;
  let any = false;
  for (const m of members) {
    if (m.netAmount != null && Number.isFinite(m.netAmount)) {
      sum += m.netAmount;
      any = true;
    }
  }
  return any ? Math.round(sum * 100) / 100 : null;
}

function addCumulative(
  prev: number | null,
  step: number | null,
): number | null {
  if (prev == null && step == null) return null;
  return Math.round(((prev ?? 0) + (step ?? 0)) * 100) / 100;
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

/**
 * Collapse a flat situation member list into a tree:
 * open (root) → adjustment branches (roll_close + roll_open) → close / current tip.
 * Sequential rolls nest so the latest structure sits at the tip.
 */
export function buildSituationTree(
  members: SituationMemberView[],
  options?: { status?: string },
): SituationTreeNode[] {
  const sorted = sortMembers(members);
  if (sorted.length === 0) return [];

  const opens = sorted.filter((m) => m.role === "open");
  const rest = sorted.filter((m) => m.role !== "open");

  const openStep = sumNets(opens);
  let running = openStep;

  const root: SituationTreeNode = {
    id: `open:${opens.map((m) => m.transactionId).join(",") || "none"}`,
    kind: "open",
    label: opens.length ? `Open · ${opens.map(memberLabel).join(" + ")}` : "Open",
    members: opens,
    stepNet: openStep,
    cumulativeNet: running,
    children: [],
  };

  let tip: SituationTreeNode = root;
  let sawClose = false;
  let i = 0;
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
      const step = sumNets([...closeMembers, ...openMembers]);
      running = addCumulative(running, step);
      const node: SituationTreeNode = {
        id: `adj:${closeMembers.map((x) => x.transactionId).join(",")}`,
        kind: "adjustment",
        label: `Adjustment · ${[...closeMembers, ...openMembers].map(memberLabel).join(" → ")}`,
        closeMembers,
        openMembers,
        stepNet: step,
        cumulativeNet: running,
        children: [],
      };
      tip.children.push(node);
      tip = node;
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
      const step = sumNets(openMembers);
      running = addCumulative(running, step);
      const node: SituationTreeNode = {
        id: `adj-open:${openMembers.map((x) => x.transactionId).join(",")}`,
        kind: "adjustment",
        label: `Adjustment · ${openMembers.map(memberLabel).join(" + ")}`,
        closeMembers: [],
        openMembers,
        stepNet: step,
        cumulativeNet: running,
        children: [],
      };
      tip.children.push(node);
      tip = node;
      continue;
    }

    if (m.role === "close") {
      const closeMembers: SituationMemberView[] = [m];
      i += 1;
      while (i < rest.length && rest[i]!.role === "close") {
        closeMembers.push(rest[i]!);
        i += 1;
      }
      const step = sumNets(closeMembers);
      running = addCumulative(running, step);
      tip.children.push({
        id: `close:${closeMembers.map((x) => x.transactionId).join(",")}`,
        kind: "close",
        label: `Close · ${closeMembers.map(memberLabel).join(" + ")}`,
        members: closeMembers,
        stepNet: step,
        cumulativeNet: running,
        children: [],
      });
      sawClose = true;
      continue;
    }

    // leg / unknown
    const step = sumNets([m]);
    running = addCumulative(running, step);
    tip.children.push({
      id: `leg:${m.transactionId}`,
      kind: "leg",
      label: `Leg · ${memberLabel(m)}`,
      member: m,
      stepNet: step,
      cumulativeNet: running,
      children: [],
    });
    i += 1;
  }

  if ((options?.status ?? "open") === "open") {
    // Current tip: symbols from the latest open/roll_open cluster still in force
    let currentSymbols: string[] = symbolsOf(opens);
    const walk = (n: SituationTreeNode) => {
      if (n.kind === "adjustment" && n.openMembers.length) {
        currentSymbols = symbolsOf(n.openMembers);
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
        cumulativeNet: running,
        children: [],
      });
    }
  }

  return [root];
}
