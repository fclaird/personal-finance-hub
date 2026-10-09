import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isoDate, makeOptionChain, type ChainDraft, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { capitalExpiryPnl, createLab, describeZone, editLab, evaluateLab, type PricedStructure } from "@/lib/strategyLab/lab";
import { bestWhenLine, describeSpotCallout, solveExpiryZones, zoneContaining, type ZoneSeries } from "@/lib/strategyLab/internal/zones";

/**
 * NOW Jan 19 2029, $10k whole contracts, idle cash not added.
 * Hand payoffs (package P&L × packages):
 *   A 6× 150/210 debit $1,555:  S<150 → -9330;  150≤S≤210 → 600S-99330;  S>210 → 26670
 *   B 8× 160/210 debit $1,235:  S<160 → -9880;  160≤S≤210 → 800S-137880; S>210 → 30120
 *   C 1× 2×120/−210 debit $8,470: S<120 → -8470; 120≤S≤210 → 200S-32470; S>210 → 100S-11470
 *
 * Pairwise roots of those pieces:
 *   A = C on (150, 210): 400S = 66860 → 167.15          (lead C → A)
 *   B = C on (160, 210): 600S = 105410 → 105410/600     (A still leads)
 *   B = A on (160, 210): 200S = 38550 → 192.75          (lead A → B)
 *   C = A on S>210:      100S = 38140 → 381.40          (B still leads)
 *   C = B on S>210:      100S = 41590 → 415.90          (lead B → C)
 * All-lose ends at C's breakeven: 200S = 32470 → 162.35
 */

const JAN = "2029-01-19";
const FEB = "2027-02-19";

const A_PASSES_C = 66860 / 400;
const B_PASSES_C = 105410 / 600;
const B_PASSES_A = 38550 / 200;
const C_PASSES_A = 38140 / 100;
const C_PASSES_B = 41590 / 100;
const ALL_LOSE_ENDS = 32470 / 200;

function pnlA(spot: number): number {
  if (spot < 150) return -9330;
  if (spot <= 210) return 600 * spot - 99330;
  return 26670;
}
function pnlB(spot: number): number {
  if (spot < 160) return -9880;
  if (spot <= 210) return 800 * spot - 137880;
  return 30120;
}
function pnlC(spot: number): number {
  if (spot < 120) return -8470;
  if (spot <= 210) return 200 * spot - 32470;
  return 100 * spot - 11470;
}

function draft(partial: Omit<ChainDraft, "quoteTime" | "fetchedAt" | "servedFrom" | "fallbackFrom" | "delayed">): ChainDraft {
  return {
    quoteTime: null,
    fetchedAt: "2026-10-08T16:13:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
    delayed: true,
    ...partial,
  };
}

function calls(expiry: string, rows: readonly (readonly [number, number, number])[]): DraftContract[] {
  return rows.map(([strike, bid, ask]) => ({
    expiry,
    right: "C" as const,
    strike,
    bid,
    ask,
    feedIv: null,
    multiplier: 100,
    root: null,
  }));
}

function chainOf(body: ChainDraft): OptionChain {
  const built = makeOptionChain(body);
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

function janChain(extra: DraftContract[] = []): OptionChain {
  return chainOf(
    draft({
      symbol: "NOW",
      spot: 136.58,
      tradeDate: "2026-10-08",
      source: "cboe",
      dividendYieldHint: 0,
      contracts: [
        ...calls(JAN, [
          [120, 53.85, 59.25],
          [150, 43.4, 44.7],
          [160, 39.75, 41.75],
          [210, 27.75, 29.05],
        ]),
        ...extra,
      ],
    }),
  );
}

function handSeries(): ZoneSeries[] {
  return [
    { id: "A", label: "A", pnl: pnlA, terminalSlope: 0, knots: [150, 210], plateauFrom: 210 },
    { id: "B", label: "B", pnl: pnlB, terminalSlope: 0, knots: [160, 210], plateauFrom: 210 },
    { id: "C", label: "C", pnl: pnlC, terminalSlope: 100, knots: [120, 210], plateauFrom: null },
  ];
}

function near(actual: number, expected: number, tol: number, label: string) {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} vs ${expected} ± ${tol}`);
}

describe("expiry zone solver, NOW Jan 2029 hand payoffs", () => {
  const solved = solveExpiryZones(handSeries());

  it("finds the five pairwise spots from the closed-form pieces", () => {
    const expected = [
      { spot: A_PASSES_C, overtakes: "A", overtaken: "C", lead: true },
      { spot: B_PASSES_C, overtakes: "B", overtaken: "C", lead: false },
      { spot: B_PASSES_A, overtakes: "B", overtaken: "A", lead: true },
      { spot: C_PASSES_A, overtakes: "C", overtaken: "A", lead: false },
      { spot: C_PASSES_B, overtakes: "C", overtaken: "B", lead: true },
    ];
    assert.equal(solved.crossovers.length, expected.length);
    for (const item of expected) {
      const hit = solved.crossovers.find(
        (crossover) => crossover.overtakesId === item.overtakes && crossover.overtakenId === item.overtaken,
      );
      assert.ok(hit, `${item.overtakes} passes ${item.overtaken}`);
      near(hit!.spot, item.spot, 1e-6, `${item.overtakes} passes ${item.overtaken}`);
      assert.equal(hit!.leadChange, item.lead);
    }
    assert.equal(A_PASSES_C, 167.15);
    assert.equal(B_PASSES_A, 192.75);
    assert.equal(C_PASSES_A, 381.4);
    assert.equal(C_PASSES_B, 415.9);
    assert.equal(ALL_LOSE_ENDS, 162.35);
    near(B_PASSES_C, 175.6833333333, 1e-9, "B passes C");
  });

  it("matches hand payoffs on both sides of each crossover", () => {
    const hands = { A: pnlA, B: pnlB, C: pnlC };
    for (const crossover of solved.crossovers) {
      const over = hands[crossover.overtakesId as "A" | "B" | "C"];
      const under = hands[crossover.overtakenId as "A" | "B" | "C"];
      near(over(crossover.spot), under(crossover.spot), 1e-4, `equal at ${crossover.spot}`);
      const left = crossover.spot - 0.01;
      const right = crossover.spot + 0.01;
      assert.ok(under(left) > over(left), `${crossover.overtakenId} leads just below ${crossover.spot}`);
      assert.ok(over(right) > under(right), `${crossover.overtakesId} leads just above ${crossover.spot}`);
    }
    near(pnlC(ALL_LOSE_ENDS), 0, 1e-6, "C breakeven");
    assert.ok(pnlA(ALL_LOSE_ENDS) < 0 && pnlB(ALL_LOSE_ENDS) < 0 && pnlC(ALL_LOSE_ENDS - 0.01) < 0);
  });

  it("splits the lead into all-lose, open wins, B's max-gain plateau, and an uncapped tail", () => {
    const lines = solved.zones.map(describeZone);
    assert.deepEqual(lines, [
      "Below $162.35: all lose, C loses least",
      "$162.35 to $167.15: C wins",
      "$167.15 to $192.75: A wins",
      "$192.75 to $210.00: B wins",
      "$210.00 to $415.90: B wins, at its max gain",
      "Above $415.90: C wins and has no cap",
    ]);
    const plateau = solved.zones.find((zone) => zone.plateau);
    assert.equal(plateau?.bestId, "B");
    const tail = solved.zones[solved.zones.length - 1]!;
    assert.equal(tail.uncapped, true);
    assert.equal(tail.bestId, "C");
    assert.ok(tail.edge > 0);
    assert.equal(bestWhenLine(solved.zones, "A"), "Best when spot ends between $167.15 and $192.75");
    assert.equal(bestWhenLine(solved.zones, "B"), "Best when spot ends between $192.75 and $415.90");
    assert.equal(bestWhenLine(solved.zones, "C"), "Best when spot ends between $162.35 and $167.15, and above $415.90");
    const now = zoneContaining(solved.zones, 136.58);
    assert.ok(now);
    assert.equal(describeSpotCallout(now!, 136.58), "If spot ends at $136.58: all lose, C loses least");
  });
});

describe("evaluateLab expiry boards", () => {
  const chain = janChain();
  const lab = editLab(
    createLab(chain),
    [
      { kind: "setBasis", basis: { kind: "equalCapital", capital: 10_000, units: "whole" } },
      {
        kind: "addStructure",
        label: "A",
        expiry: isoDate(JAN),
        request: { template: "callDebitSpread", long: { by: "strike", strike: 150 }, short: { by: "strike", strike: 210 } },
        entry: { kind: "limit", netPerShare: 15.55 },
      },
      {
        kind: "addStructure",
        label: "B",
        expiry: isoDate(JAN),
        request: { template: "callDebitSpread", long: { by: "strike", strike: 160 }, short: { by: "strike", strike: 210 } },
        entry: { kind: "limit", netPerShare: 12.35 },
      },
      {
        kind: "addStructure",
        label: "C",
        expiry: isoDate(JAN),
        request: { template: "zebra", long: { by: "strike", strike: 120 }, short: { by: "strike", strike: 210 } },
        entry: { kind: "limit", netPerShare: 84.7 },
      },
    ],
    chain,
  );

  it("uses the shared capital basis and leaves the stock baseline out", () => {
    assert.equal(createLab(chain).compareStock, false);
    const ev = evaluateLab(lab, chain);
    assert.equal(ev.metric, "P&L on $10,000, whole contracts, idle cash earns 0");
    assert.equal(ev.expiryBoards.length, 1);
    const board = ev.expiryBoards[0]!;
    assert.equal(board.exact, true);
    assert.equal(board.note, null);
    assert.equal(board.structureIds.includes("stock"), false);
    assert.deepEqual(
      board.crossovers.map((crossover) => crossover.spot),
      [A_PASSES_C, B_PASSES_C, B_PASSES_A, C_PASSES_A, C_PASSES_B],
    );
    const byLabel = Object.fromEntries(
      ev.structures.filter((row): row is PricedStructure => row.status === "priced").map((row) => [row.spec.label, row]),
    ) as Record<string, PricedStructure>;
    for (const spot of [100, A_PASSES_C, B_PASSES_C, 200, 210, C_PASSES_A, C_PASSES_B, 500]) {
      near(capitalExpiryPnl(byLabel.A!, spot) ?? NaN, pnlA(spot), 1e-6, `A at ${spot}`);
      near(capitalExpiryPnl(byLabel.B!, spot) ?? NaN, pnlB(spot), 1e-6, `B at ${spot}`);
      near(capitalExpiryPnl(byLabel.C!, spot) ?? NaN, pnlC(spot), 1e-6, `C at ${spot}`);
    }
    const halfway = ev.horizons.find((horizon) => !horizon.settlement);
    const expiry = ev.horizons.find((horizon) => horizon.settlement);
    assert.ok(halfway && expiry);
    assert.ok(ev.modelCrossovers.every((crossover) => crossover.approximate && crossover.horizonId === halfway!.id));
    assert.equal(ev.modelCrossovers.some((crossover) => crossover.horizonId === expiry!.id), false);
  });

  it("moves the crossover when whole-contract counts stop scaling together", () => {
    const smaller = editLab(lab, { kind: "setBasis", basis: { kind: "equalCapital", capital: 9_000, units: "whole" } }, chain);
    const board = evaluateLab(smaller, chain).expiryBoards[0]!;
    const hit = board.crossovers.find((crossover) => crossover.overtakesLabel === "A" && crossover.overtakenLabel === "C");
    assert.ok(hit);
    assert.ok(Math.abs(hit!.spot - A_PASSES_C) > 0.1);
    const ev = evaluateLab(smaller, chain);
    const byLabel = Object.fromEntries(
      ev.structures.filter((row): row is PricedStructure => row.status === "priced").map((row) => [row.spec.label, row]),
    ) as Record<string, PricedStructure>;
    const a = capitalExpiryPnl(byLabel.A!, hit!.spot);
    const c = capitalExpiryPnl(byLabel.C!, hit!.spot);
    near(a ?? NaN, c ?? NaN, 1e-4, "resized A and C meet");
  });

  it("keeps expiry zones fixed when a leg IV override moves the halfway curve", () => {
    const before = evaluateLab(lab, chain);
    const c = before.structures.find((row) => row.spec.label === "C");
    assert.ok(c);
    const after = evaluateLab(editLab(lab, { kind: "setIvOverride", id: c!.spec.id, legIndex: 0, iv: 0.2 }, chain), chain);
    assert.deepEqual(
      before.expiryBoards[0]!.crossovers.map((item) => item.spot),
      after.expiryBoards[0]!.crossovers.map((item) => item.spot),
    );
    const horizon = before.horizons.find((item) => !item.settlement)!;
    const spot = before.spot;
    const pnl = (ev: typeof before) => {
      const row = ev.structures.find((item) => item.spec.label === "C");
      if (!row || row.status !== "priced") return null;
      return row.curves.find((curve) => curve.horizonId === horizon.id)?.points.find((point) => point.spot === spot)?.pnl ?? null;
    };
    assert.notEqual(pnl(before), pnl(after));
  });
});

describe("zone edge cases", () => {
  const chain = janChain(calls(FEB, [[130, 20.65, 22.45], [200, 3.25, 4.2]]));

  it("reports no crossover when one debit spread is strictly cheaper", () => {
    const lab = editLab(
      createLab(chain),
      [
        {
          kind: "addStructure",
          label: "Cheap",
          expiry: isoDate(JAN),
          request: { template: "callDebitSpread", long: { by: "strike", strike: 150 }, short: { by: "strike", strike: 210 } },
          entry: { kind: "limit", netPerShare: 15.55 },
        },
        {
          kind: "addStructure",
          label: "Rich",
          expiry: isoDate(JAN),
          request: { template: "callDebitSpread", long: { by: "strike", strike: 150 }, short: { by: "strike", strike: 210 } },
          entry: { kind: "limit", netPerShare: 16.55 },
        },
      ],
      chain,
    );
    const board = evaluateLab(lab, chain).expiryBoards[0]!;
    assert.equal(board.crossovers.length, 0);
    assert.ok(board.zones.every((zone) => zone.bestLabel === "Cheap" && !zone.tied));
    assert.ok(board.zones.every((zone) => Math.abs(zone.edge - 600) < 1e-6));
  });

  it("treats identical payoffs as a tie with no crossover", () => {
    const lab = editLab(
      createLab(chain),
      [
        {
          kind: "addStructure",
          label: "A",
          expiry: isoDate(JAN),
          request: { template: "callDebitSpread", long: { by: "strike", strike: 150 }, short: { by: "strike", strike: 210 } },
          entry: { kind: "limit", netPerShare: 15.55 },
        },
        {
          kind: "addStructure",
          label: "B",
          expiry: isoDate(JAN),
          request: { template: "callDebitSpread", long: { by: "strike", strike: 150 }, short: { by: "strike", strike: 210 } },
          entry: { kind: "limit", netPerShare: 15.55 },
        },
      ],
      chain,
    );
    const board = evaluateLab(lab, chain).expiryBoards[0]!;
    assert.equal(board.crossovers.length, 0);
    assert.ok(board.zones.length > 0);
    assert.ok(board.zones.every((zone) => zone.tied && zone.edge === 0));
  });

  it("keeps exact zones inside one expiry and labels the other expiry approximate", () => {
    const lab = editLab(
      createLab(chain),
      [
        {
          kind: "addStructure",
          label: "A",
          expiry: isoDate(JAN),
          request: { template: "callDebitSpread", long: { by: "strike", strike: 150 }, short: { by: "strike", strike: 210 } },
          entry: { kind: "limit", netPerShare: 15.55 },
        },
        {
          kind: "addStructure",
          label: "B",
          expiry: isoDate(JAN),
          request: { template: "callDebitSpread", long: { by: "strike", strike: 160 }, short: { by: "strike", strike: 210 } },
          entry: { kind: "limit", netPerShare: 12.35 },
        },
        {
          kind: "addStructure",
          label: "Feb",
          expiry: isoDate(FEB),
          request: { template: "callDebitSpread", long: { by: "strike", strike: 130 }, short: { by: "strike", strike: 200 } },
          entry: { kind: "limit", netPerShare: 17 },
        },
      ],
      chain,
    );
    const ev = evaluateLab(lab, chain);
    const jan = ev.expiryBoards.find((board) => board.expiry === isoDate(JAN));
    const feb = ev.expiryBoards.find((board) => board.expiry === isoDate(FEB));
    assert.ok(jan && feb);
    assert.equal(jan!.exact, true);
    assert.equal(feb!.exact, false);
    assert.match(feb!.note ?? "", /approximate/i);
    assert.equal(feb!.crossovers.length, 0);
    const janIds = new Set(ev.structures.filter((row) => row.spec.expiry === isoDate(JAN)).map((row) => row.spec.id));
    const febId = ev.structures.find((row) => row.spec.label === "Feb")!.spec.id;
    assert.equal(jan!.structureIds.includes(febId), false);
    assert.ok(jan!.crossovers.every((crossover) => janIds.has(crossover.overtakesId) && janIds.has(crossover.overtakenId)));
    assert.ok(jan!.crossovers.some((crossover) => crossover.leadChange));
  });

  it("can add the stock baseline and meets it at the solved spot", () => {
    const lab = editLab(
      createLab(chain),
      [
        { kind: "setCompareStock", compare: true },
        {
          kind: "addStructure",
          label: "A",
          expiry: isoDate(JAN),
          request: { template: "callDebitSpread", long: { by: "strike", strike: 150 }, short: { by: "strike", strike: 210 } },
          entry: { kind: "limit", netPerShare: 15.55 },
        },
      ],
      chain,
    );
    const ev = evaluateLab(lab, chain);
    const board = ev.expiryBoards[0]!;
    const hit = board.crossovers.find((crossover) => crossover.overtakesId === "stock" || crossover.overtakenId === "stock");
    assert.ok(hit);
    const row = ev.structures.find((item) => item.spec.label === "A");
    assert.ok(row && row.status === "priced");
    const stock = ((hit!.spot - ev.spot) / ev.spot) * 10_000;
    near(capitalExpiryPnl(row, hit!.spot) ?? NaN, stock, 1e-4, "stock meets A");
  });
});
