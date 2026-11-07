import { crrPrice } from "@/lib/fortress/american";
import { yearFraction } from "@/lib/fortress/dates";
import { exposures, nWeight, type Known } from "@/lib/fortress/exposure";
import { applyChangeSet, cloneSnapshot, debtPrincipal, netAssetValue, settleDue, settledCash } from "@/lib/fortress/ledger";
import { declineToCritical, firstMaintenanceBreach, longStockExcess, marginPoints } from "@/lib/fortress/margin";
import type { Assumptions, Change, MarketNode, MarketState, OptionPosition, Snapshot, Threshold } from "@/lib/fortress/types";
import { DEFAULT_ASSUMPTIONS, FORTRESS_MODEL_VERSION, FORTRESS_PHASE, FORTRESS_RULE_VERSION } from "@/lib/fortress/types";

export type MetricStatus = "pass" | "breach" | "unknown" | "not-evaluated";

export type MetricRow = {
  readonly id: string;
  readonly label: string;
  readonly before: number | null;
  readonly after: number | null;
  readonly diff: number | null;
  readonly unit: string;
  readonly denominator: string;
  readonly horizon: string;
  readonly limit: number | null;
  readonly direction: "max" | "min" | null;
  readonly status: MetricStatus;
  readonly bindingScenario: string | null;
  readonly evidence: string;
};

export type PathPoint = {
  readonly nodeId: string;
  readonly date: string;
  readonly spotFactor: number;
  readonly nav: number | null;
  readonly maintenanceExcess: number | null;
  readonly settledCash: number;
  readonly fundingGap: number;
  readonly blocked: string | null;
};

export type Verdict = { readonly kind: "breach" | "blocked" | "evaluated-pass"; readonly summary: string };

export type FortressResult = {
  readonly model: string;
  readonly rules: string;
  readonly phasesImplemented: readonly number[];
  readonly phasesUnavailable: readonly number[];
  readonly rejected: readonly { readonly id: string; readonly reason: string }[];
  readonly before: Snapshot;
  readonly after: Snapshot;
  readonly rows: readonly MetricRow[];
  readonly baselinePath: readonly PathPoint[];
  readonly changedPath: readonly PathPoint[];
  readonly changedTerminal: Snapshot;
  readonly breach: ReturnType<typeof firstMaintenanceBreach>;
  readonly verdict: Verdict;
  readonly unavailable: readonly string[];
};

function knownNumber(result: Known): number | null {
  return result.status === "known" ? result.value : null;
}

function blockReason(snapshot: Snapshot): string | null {
  for (const position of snapshot.positions) {
    if (position.kind !== "option") continue;
    if (position.contract.exotic) return `${position.id} is exotic and blocks a complete verdict.`;
    if (position.contract.adjusted && position.contract.adjustedMetadata !== "complete") return `${position.id} is adjusted without complete deliverable metadata.`;
    if (!(position.contract.multiplier > 0)) return `${position.id} has no multiplier.`;
  }
  return null;
}

function reprice(snapshot: Snapshot, market: MarketState, assumptions: Assumptions, asOf: string): Snapshot {
  const positions = snapshot.positions.map((position) => {
    if (position.kind !== "option") {
      const spot = market.spots[position.symbol];
      return spot != null && spot > 0 ? { ...position, mark: spot } : position;
    }
    const spot = market.spots[position.contract.underlying];
    const vol = (market.vols[position.contract.underlying] ?? assumptions.baseVol) ;
    if (!(spot != null && spot > 0)) return { ...position, mark: null, delta: null, gamma: null, vegaPerVol: null };
    const years = Math.max(0, yearFraction(asOf, position.contract.expiry));
    const priced = crrPrice({
      right: position.contract.right,
      style: position.contract.style,
      spot,
      strike: position.contract.strike,
      years,
      rate: market.rate,
      dividendYield: market.dividendYield[position.contract.underlying] ?? assumptions.dividendYield,
      vol,
      steps: assumptions.americanSteps,
    });
    if (!priced.ok) return { ...position, mark: null, delta: null, gamma: null, vegaPerVol: null };
    return { ...position, mark: priced.value.price, delta: priced.value.delta, gamma: priced.value.gamma, vegaPerVol: priced.value.vegaPerVol };
  });
  return { ...snapshot, positions };
}

function accrue(snapshot: Snapshot, from: string, to: string, assumptions: Assumptions): Snapshot {
  const years = yearFraction(from, to);
  if (!(years > 0)) return snapshot;
  let next = snapshot;
  for (const debt of snapshot.debt) {
    const eventId = `int:${debt.id}:${to}`;
    if (next.appliedEventIds.includes(eventId)) continue;
    const interest = debt.principal * debt.annualRate * years;
    if (assumptions.payInterestFromCash) {
      next = { ...next, payables: [...next.payables, { id: eventId, accountId: debt.accountId, amount: interest, due: to, label: "Debt interest" }] };
    } else {
      next = { ...next, debt: next.debt.map((row) => (row.id === debt.id ? { ...row, principal: row.principal + interest } : row)) };
    }
    next = { ...next, appliedEventIds: [...next.appliedEventIds, eventId] };
  }
  for (const dividend of snapshot.dividends) {
    if (dividend.exDate <= from || dividend.exDate > to) continue;
    if (next.appliedEventIds.includes(dividend.id)) continue;
    const shares = next.positions.reduce((sum, position) => (position.kind !== "option" && position.symbol === dividend.underlying ? sum + position.quantity : sum), 0);
    const amount = shares * dividend.amountPerShare;
    if (amount > 0) next = { ...next, receivables: [...next.receivables, { id: dividend.id, accountId: next.cash[0]?.accountId ?? "primary", amount, due: dividend.exDate, label: `Dividend ${dividend.underlying}` }] };
    if (amount < 0) next = { ...next, payables: [...next.payables, { id: dividend.id, accountId: next.cash[0]?.accountId ?? "primary", amount: -amount, due: dividend.exDate, label: `Short dividend ${dividend.underlying}` }] };
    next = { ...next, appliedEventIds: [...next.appliedEventIds, dividend.id] };
  }
  return settleDue(next, to);
}

function settleOption(snapshot: Snapshot, position: OptionPosition, spot: number, asOf: string, assignment: "none" | "partial" | "full"): Snapshot {
  const eventId = `exp:${position.id}:${asOf}:${assignment}`;
  if (snapshot.appliedEventIds.includes(eventId) || position.contract.expiry > asOf) return snapshot;
  const fraction = assignment === "none" ? 0 : assignment === "partial" ? 0.5 : 1;
  const qty = position.quantity * fraction;
  const restQty = position.quantity - qty;
  let positions = snapshot.positions.filter((row) => row.id !== position.id);
  if (Math.abs(restQty) > 1e-8) positions = [...positions, { ...position, quantity: restQty }];
  let next: Snapshot = { ...snapshot, positions, appliedEventIds: [...snapshot.appliedEventIds, eventId] };
  const accountId = position.accountId;
  const intrinsic = position.contract.right === "C" ? Math.max(spot - position.contract.strike, 0) : Math.max(position.contract.strike - spot, 0);
  if (intrinsic <= 0 || qty === 0) return next;
  if (position.contract.settlement === "cash") {
    const cash = qty * intrinsic * position.contract.multiplier;
    if (cash > 0) next = { ...next, receivables: [...next.receivables, { id: `${eventId}:cash`, accountId, amount: cash, due: asOf, label: "Cash settlement" }] };
    else next = { ...next, payables: [...next.payables, { id: `${eventId}:cash`, accountId, amount: -cash, due: asOf, label: "Cash settlement" }] };
    return settleDue(next, asOf);
  }
  const shareSign = position.contract.right === "C" ? 1 : -1;
  const shareChange = qty * position.contract.deliverableShares * shareSign;
  const cashChange = -qty * position.contract.strike * position.contract.deliverableShares * shareSign;
  const symbol = position.contract.underlying;
  const existing = next.positions.find((row) => row.kind !== "option" && row.symbol === symbol && row.accountId === accountId);
  const prevQty = existing && existing.kind !== "option" ? existing.quantity : 0;
  const equityId = existing?.id ?? `${eventId}:shares`;
  const without = next.positions.filter((row) => row.id !== equityId);
  next = {
    ...next,
    positions: [...without, { id: equityId, kind: "equity", symbol, accountId, quantity: prevQty + shareChange, mark: spot, averageCost: position.contract.strike }],
  };
  if (cashChange > 0) next = { ...next, receivables: [...next.receivables, { id: `${eventId}:strike`, accountId, amount: cashChange, due: asOf, label: "Exercise cash in" }] };
  else if (cashChange < 0) next = { ...next, payables: [...next.payables, { id: `${eventId}:strike`, accountId, amount: -cashChange, due: asOf, label: "Exercise cash out" }] };
  return settleDue(next, asOf);
}

function assignmentMode(position: OptionPosition, node: MarketNode, assumptions: Assumptions): "none" | "partial" | "full" {
  if (position.contract.expiry > node.date) return assumptions.assignmentBeforeExpiry;
  return assumptions.assignmentAtExpiry;
}

function stepBook(snapshot: Snapshot, market: MarketState, node: MarketNode, previousDate: string, assumptions: Assumptions): { readonly snapshot: Snapshot; readonly blocked: string | null } {
  const blocked = blockReason(snapshot);
  let next = accrue(snapshot, previousDate, node.date, assumptions);
  const scaled: MarketState = {
    ...market,
    asOf: node.date,
    rate: market.rate + node.rateAdd,
    spots: Object.fromEntries(Object.entries(market.spots).map(([symbol, spot]) => [symbol, spot * node.spotFactor])),
    vols: Object.fromEntries(Object.entries(market.vols).map(([symbol, vol]) => [symbol, vol + node.volAdd])),
  };
  next = reprice(next, scaled, assumptions, node.date);
  const options = next.positions.filter((position): position is OptionPosition => position.kind === "option");
  for (const position of options) {
    const mode = assignmentMode(position, node, assumptions);
    const spot = scaled.spots[position.contract.underlying] ?? 0;
    if (position.quantity < 0) {
      if (mode !== "none") next = settleOption(next, position, spot, node.date, mode);
    } else if (position.contract.expiry <= node.date) {
      next = settleOption(next, position, spot, node.date, "full");
    }
  }
  return { snapshot: next, blocked };
}

function fundingGap(snapshot: Snapshot, reserve: number): number {
  const unpaid = snapshot.payables.reduce((sum, row) => sum + row.amount, 0);
  return Math.max(0, reserve - settledCash(snapshot)) + unpaid;
}

function walk(snapshot: Snapshot, market: MarketState, path: readonly MarketNode[], assumptions: Assumptions): { readonly points: PathPoint[]; readonly terminal: Snapshot } {
  let book = cloneSnapshot(snapshot);
  let previous = market.asOf;
  const points: PathPoint[] = [];
  for (const node of path) {
    const stepped = stepBook(book, market, node, previous, assumptions);
    book = stepped.snapshot;
    const nav = netAssetValue(book);
    const maintenance = book.margin.maintenanceLong + node.houseHike;
    const symbol = book.positions.find((position) => position.kind !== "option")?.symbol;
    const spot = symbol ? (market.spots[symbol] ?? 0) * node.spotFactor : 0;
    const gross = symbol ? book.positions.reduce((sum, position) => (position.kind !== "option" && position.symbol === symbol ? sum + position.quantity * spot : sum), 0) : 0;
    const excess = longStockExcess(gross, debtPrincipal(book), maintenance);
    points.push({
      nodeId: node.id,
      date: node.date,
      spotFactor: node.spotFactor,
      nav: nav.status === "known" ? nav.value : null,
      maintenanceExcess: excess,
      settledCash: settledCash(book),
      fundingGap: fundingGap(book, assumptions.operationalReserve),
      blocked: stepped.blocked,
    });
    previous = node.date;
  }
  return { points, terminal: book };
}

function judge(value: number | null, limit: Threshold | undefined, evidence: string, binding: string | null): MetricRow {
  const base = {
    before: null as number | null,
    after: value,
    diff: null as number | null,
    unit: "",
    denominator: "",
    horizon: "",
    limit: limit?.limit ?? null,
    direction: limit?.direction ?? null,
    bindingScenario: binding,
    evidence,
  };
  if (!limit || limit.limit == null) return { ...base, id: "", label: "", status: "not-evaluated" };
  if (value == null) return { ...base, id: "", label: "", status: "unknown" };
  const breach = limit.direction === "max" ? value > limit.limit : value < limit.limit;
  return { ...base, id: "", label: "", status: breach ? "breach" : "pass" };
}

function row(partial: Omit<MetricRow, "diff"> & { readonly before: number | null; readonly after: number | null }): MetricRow {
  const diff = partial.before != null && partial.after != null ? partial.after - partial.before : null;
  return { ...partial, diff };
}

export function evaluateFortress(input: {
  readonly baseline: Snapshot;
  readonly changes: readonly Change[];
  readonly market: MarketState;
  readonly path: readonly MarketNode[];
  readonly assumptions?: Assumptions;
  readonly limits?: readonly Threshold[];
}): FortressResult {
  const assumptions = input.assumptions ?? DEFAULT_ASSUMPTIONS;
  const limits = input.limits ?? [];
  const beforeFrozen = cloneSnapshot(input.baseline);
  const applied = applyChangeSet(input.baseline, input.changes, assumptions);
  const rejected = applied.results.filter((result) => !result.accepted).map((result, index) => ({ id: input.changes[index]?.id ?? String(index), reason: result.reason ?? "Rejected." }));
  const beforeNav = netAssetValue(beforeFrozen);
  const afterNav = netAssetValue(applied.snapshot);
  const baselineWalk = walk(beforeFrozen, input.market, input.path, assumptions);
  const changedWalk = walk(applied.snapshot, input.market, input.path, assumptions);
  const baselinePath = baselineWalk.points;
  const changedPath = changedWalk.points;
  const startValue = beforeFrozen.positions.reduce((sum, position) => (position.kind === "option" ? sum : sum + position.quantity * position.mark), 0);
  const points = marginPoints(input.path, startValue, debtPrincipal(applied.snapshot), applied.snapshot.margin.maintenanceLong);
  const breach = firstMaintenanceBreach(points, applied.snapshot.margin.maintenanceLong, debtPrincipal(applied.snapshot), startValue);
  const beforeExposure = exposures(beforeFrozen, input.market.spots);
  const afterExposure = exposures(changedWalk.terminal, input.market.spots);
  const beforeN = nWeight(beforeExposure);
  const afterN = nWeight(afterExposure);
  const decline = declineToCritical(startValue, debtPrincipal(applied.snapshot), applied.snapshot.margin.maintenanceLong);
  const cure = Math.max(0, ...points.map((point) => (point.excess == null ? 0 : -point.excess)));

  const limitFor = (metric: string) => limits.find((item) => item.metric === metric);
  const maintenanceLimit = limitFor("maintenanceExcess");
  const maintenanceValue = points.reduce<number | null>((worst, point) => (point.excess == null ? worst : worst == null ? point.excess : Math.min(worst, point.excess)), null);
  const maintenanceStatus = judge(maintenanceValue, maintenanceLimit, "Manual long-stock maintenance. Not a broker calculation.", breach.nodeId);
  const maintenanceRowStatus: MetricStatus = breach.status === "breach" || breach.status === "already-deficient" ? "breach" : breach.status === "unknown" ? "unknown" : maintenanceStatus.status;
  const rows: MetricRow[] = [
    row({
      id: "nav",
      label: "Economic NAV",
      before: beforeNav.status === "known" ? beforeNav.value : null,
      after: afterNav.status === "known" ? afterNav.value : null,
      unit: "USD",
      denominator: "assets + cash + receivables − payables − debt",
      horizon: input.baseline.asOf,
      limit: null,
      direction: null,
      status: beforeNav.status === "unknown" || afterNav.status === "unknown" ? "unknown" : "not-evaluated",
      bindingScenario: null,
      evidence: "NAV is not broker margin equity. A missing option mark makes NAV unknown.",
    }),
    row({
      id: "maintenanceExcess",
      label: "Maintenance excess",
      before: longStockExcess(startValue, debtPrincipal(beforeFrozen), beforeFrozen.margin.maintenanceLong),
      after: maintenanceValue,
      unit: "USD",
      denominator: "market value − debit − maintenance × market value",
      horizon: input.path[0]?.date ?? input.baseline.asOf,
      limit: maintenanceStatus.limit,
      direction: maintenanceStatus.direction,
      status: maintenanceRowStatus,
      bindingScenario: breach.nodeId,
      evidence: maintenanceStatus.evidence,
    }),
    row({
      id: "criticalDecline",
      label: "Critical long-stock decline",
      before: declineToCritical(startValue, debtPrincipal(beforeFrozen), beforeFrozen.margin.maintenanceLong),
      after: decline,
      unit: "fraction of starting value",
      denominator: "1 − D / ((1 − m) V0)",
      horizon: "instantaneous spot",
      limit: limitFor("criticalDecline")?.limit ?? null,
      direction: limitFor("criticalDecline")?.direction ?? null,
      status: decline == null ? "unknown" : judge(decline, limitFor("criticalDecline"), "Stock fixture D/(1−m).", null).status,
      bindingScenario: null,
      evidence: "Long stock only. Not a mixed-option or broker house formula.",
    }),
    row({
      id: "nWeight",
      label: "Nweight",
      before: knownNumber(beforeN),
      after: knownNumber(afterN),
      unit: "1 / HHI",
      denominator: "absolute net delta dollars",
      horizon: input.baseline.asOf,
      limit: limitFor("nWeight")?.limit ?? null,
      direction: limitFor("nWeight")?.direction ?? null,
      status: afterN.status === "unknown" ? "unknown" : judge(afterN.value, limitFor("nWeight"), "Inverse HHI of absolute delta dollars.", null).status,
      bindingScenario: null,
      evidence: afterN.status === "unknown" ? afterN.reason : "Not an independent-bet count, and not a 9 or 15 name rule.",
    }),
    row({
      id: "fundingGap",
      label: "Funding gap",
      before: baselinePath[0]?.fundingGap ?? null,
      after: changedPath.reduce((max, point) => Math.max(max, point.fundingGap), 0),
      unit: "USD",
      denominator: "unpaid payables plus reserve shortfall",
      horizon: input.path.at(-1)?.date ?? input.baseline.asOf,
      limit: limitFor("fundingGap")?.limit ?? null,
      direction: limitFor("fundingGap")?.direction ?? null,
      status: (changedPath.reduce((max, point) => Math.max(max, point.fundingGap), 0) > 0 ? "breach" : "pass") as MetricStatus,
      bindingScenario: changedPath.find((point) => point.fundingGap > 0)?.nodeId ?? null,
      evidence: "Cure cash is reported separately and is not deposited.",
    }),
    row({
      id: "fundingCure",
      label: "Funding cure",
      before: null,
      after: cure,
      unit: "USD",
      denominator: "maintenance shortfall at the first breach",
      horizon: breach.date ?? "not breached",
      limit: null,
      direction: null,
      status: breach.status === "unknown" ? "unknown" : "not-evaluated",
      bindingScenario: breach.nodeId,
      evidence: breach.evidence,
    }),
  ];

  const anyUnknown = rows.some((item) => item.status === "unknown");
  const anyBreach = rows.some((item) => item.status === "breach") || breach.status === "breach" || breach.status === "already-deficient";
  const blockedPath = changedPath.some((point) => point.blocked) || rejected.length > 0;
  let verdict: Verdict;
  if (blockedPath || anyUnknown) {
    verdict = { kind: "blocked", summary: "Verdict blocked. A required input is unknown, a contract is unsupported, or a change was rejected. This is not a pass." };
  } else if (anyBreach) {
    verdict = { kind: "breach", summary: "A tested limit or maintenance node fails. Later recovery does not erase the first breach." };
  } else {
    verdict = { kind: "evaluated-pass", summary: "Evaluated rows pass on the tested path. Unset limits were not evaluated. This is not an all-clear and it is not a broker verdict." };
  }

  return {
    model: FORTRESS_MODEL_VERSION,
    rules: FORTRESS_RULE_VERSION,
    phasesImplemented: FORTRESS_PHASE.implemented,
    phasesUnavailable: FORTRESS_PHASE.unavailable,
    rejected,
    before: beforeFrozen,
    after: applied.snapshot,
    rows,
    baselinePath,
    changedPath,
    breach,
    changedTerminal: changedWalk.terminal,
    verdict,
    unavailable: [
      "Phase 3 tail ES, historical replay, and proxy implied vol are not computed.",
      "Phase 4 factor scores, revenue geography, and fund look-through are not computed.",
      "The raw close cache is not used as an adjusted total return.",
    ],
  };
}

export function unitizedDrawdown(navs: readonly number[], externalFlows: readonly number[]): { readonly maxDrawdown: number | null; readonly recovered: boolean; readonly survival: "ok" | "failed"; readonly label: string } {
  if (navs.length === 0 || navs.length !== externalFlows.length) {
    return { maxDrawdown: null, recovered: false, survival: "ok", label: "Not recovered by horizon." };
  }
  let units = 1;
  let peak = 0;
  let maxDrawdown = 0;
  let underwater = false;
  let survival: "ok" | "failed" = "ok";
  const unitValues: number[] = [];
  for (let i = 0; i < navs.length; i++) {
    const nav = navs[i]!;
    if (!(nav > 0)) survival = "failed";
    const flow = externalFlows[i] ?? 0;
    const preFlow = nav - flow;
    if (flow !== 0 && preFlow > 0) units += flow / preFlow;
    const unit = units !== 0 ? nav / units : nav;
    unitValues.push(unit);
    if (survival === "ok" && unit > peak) peak = unit;
    if (survival === "ok" && peak > 0 && unit < peak - 1e-8) {
      underwater = true;
      maxDrawdown = Math.max(maxDrawdown, (peak - unit) / peak);
    }
  }
  if (survival === "failed") return { maxDrawdown: null, recovered: false, survival, label: "Not recovered by horizon." };
  const end = unitValues[unitValues.length - 1] ?? 0;
  const recovered = !underwater || end + 1e-8 >= peak;
  const label = !underwater ? "No drawdown on the tested path." : recovered ? "Recovered inside the tested horizon." : "Not recovered by horizon.";
  return { maxDrawdown, recovered, survival, label };
}

export function recoveryLabel(recoveredByHorizon: boolean): string {
  return recoveredByHorizon ? "Recovered inside the tested horizon." : "Not recovered by horizon.";
}
