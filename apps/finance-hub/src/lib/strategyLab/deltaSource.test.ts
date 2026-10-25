import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { makeOptionChain, type ChainDraft, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { createLab, editLab, evaluateLab } from "@/lib/strategyLab/lab";
import { spreadShareDelta } from "@/lib/strategyLab/callSpreadOptimizer";
import { sampleStructureDelta } from "@/lib/strategyLab/deltaCurves";
import { analysisSeries, analysisShareDelta, seriesForDeltaSource } from "@/lib/strategyLab/deltaSource";
import { draftHeldBook, heldAccountChoices, type HeldPositionRow } from "@/lib/strategyLab/positionsImport";
import { parseScenario } from "@/lib/strategyLab/scenarioStore";

const NEAR = "2027-01-15";
const FAR = "2027-06-18";

function chainFrom(contracts: readonly DraftContract[]): OptionChain {
  const body: ChainDraft = {
    symbol: "PLTR",
    spot: 100,
    tradeDate: "2026-10-09",
    quoteTime: null,
    source: "cboe",
    delayed: true,
    dividendYieldHint: 0,
    contracts,
    fetchedAt: "2026-10-09T15:00:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
  };
  const built = makeOptionChain(body);
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

function occ(expiry: string, strike: number): string {
  const yymmdd = expiry.slice(2, 4) + expiry.slice(5, 7) + expiry.slice(8, 10);
  return `PLTR  ${yymmdd}C${String(Math.round(strike * 1000)).padStart(8, "0")}`;
}

describe("effective delta source", () => {
  it("switches the chart series between optimizer rows and the main analysis", () => {
    const optimizer = [
      { key: "picked", name: "110/130", selected: true },
      { key: "shift", name: "120/140", selected: false },
    ];
    const analysis = [{ key: "s1", name: "Held PLTR" }];
    assert.deepEqual(
      seriesForDeltaSource("optimizer", optimizer, analysis).map((row) => row.key),
      ["picked", "shift"],
    );
    assert.equal(seriesForDeltaSource("optimizer", optimizer, analysis)[0]?.selected, true);
    assert.deepEqual(
      seriesForDeltaSource("analysis", optimizer, analysis).map((row) => [row.key, row.selected]),
      [["s1", false]],
    );
  });

  it("plots a large composite and one account with the same delta as the main analysis", () => {
    const accountA = Array.from({ length: 20 }, (_, index) => 50 + index * 5);
    const accountB = Array.from({ length: 12 }, (_, index) => 160 + index * 5);
    const rows: HeldPositionRow[] = [
      ...accountA.map((strike) => ({
        symbol: occ(NEAR, strike),
        quantity: strike === 50 ? 250 : 4,
        averagePrice: 1.2,
        securityType: "option",
        accountId: "acct-a",
        effectiveUnderlyingSymbol: "PLTR",
      })),
      ...accountB.map((strike) => ({
        symbol: occ(FAR, strike),
        quantity: -3,
        averagePrice: 0.8,
        securityType: "option",
        accountId: "acct-b",
        effectiveUnderlyingSymbol: "PLTR",
      })),
      { symbol: "PLTR", quantity: 200, averagePrice: 40, securityType: "equity", accountId: "acct-a", effectiveUnderlyingSymbol: "PLTR" },
    ];
    const accounts = [
      { id: "acct-a", name: "Joint brokerage", nickname: "Joint" },
      { id: "acct-b", name: "IRA", nickname: null },
    ];
    const choices = heldAccountChoices(rows, "PLTR", accounts);
    assert.deepEqual(
      choices.map((choice) => [choice.id, choice.label, choice.legs]),
      [
        ["all", "All accounts", 32],
        ["acct-b", "IRA", 12],
        ["acct-a", "Joint", 20],
      ],
    );
    const all = draftHeldBook({ rows, symbol: "PLTR", accountId: "all", accountLabel: "All accounts" });
    const joint = draftHeldBook({ rows, symbol: "PLTR", accountId: "acct-a", accountLabel: "Joint" });
    const ira = draftHeldBook({ rows, symbol: "PLTR", accountId: "acct-b", accountLabel: "IRA" });
    assert.equal(all.ok && joint.ok && ira.ok, true);
    if (!all.ok || !joint.ok || !ira.ok) return;
    assert.equal(all.draft.legs.length, 32);
    assert.equal(all.draft.stock?.shares, 200);
    assert.equal(all.summary.contracts, 250 + 19 * 4 + 12 * 3);
    assert.equal(joint.draft.legs.length, 20);
    assert.equal(joint.draft.legs.find((leg) => leg.strike === 50)?.ratio, 250);
    assert.equal(joint.draft.stock?.shares, 200);
    assert.equal(ira.draft.legs.length, 12);
    assert.equal(ira.draft.stock, null);
    assert.ok(ira.draft.legs.every((leg) => leg.ratio === -3));

    const contracts: DraftContract[] = [...accountA, ...accountB].map((strike) => ({
      expiry: accountA.includes(strike) ? NEAR : FAR,
      right: "C" as const,
      strike,
      bid: 1,
      ask: 1.4,
      feedIv: 0.4,
      multiplier: 100,
      root: null,
    }));
    const chain = chainFrom(contracts);
    const load = (draft: typeof all.draft) =>
      editLab(
        createLab(chain),
        [
          { kind: "setBasis", basis: { kind: "perPackage" } },
          { kind: "setHorizons", horizons: [{ kind: "anchorExpiry" }] },
          {
            kind: "importHeld",
            expiry: draft.expiry,
            label: draft.label,
            legs: draft.legs,
            netPerShare: draft.netPerShare,
            stock: draft.stock,
          },
        ],
        chain,
      );
    const composite = load(all.draft);
    assert.equal(composite.structures[0]?.legs.length, 33);
    const restored = parseScenario(JSON.parse(JSON.stringify(composite)));
    assert.ok(restored);
    assert.equal(restored?.structures[0]?.legs.length, 33);
    assert.equal(restored?.structures[0]?.legs.find((leg) => leg.strike === 50)?.ratio, 250);

    const evaluation = evaluateLab(composite, chain);
    const id = composite.structures[0]!.id;
    assert.deepEqual(
      analysisSeries(evaluation, null).map((row) => row.id),
      [id],
    );
    assert.deepEqual(analysisSeries(evaluation, []), []);
    const horizon = evaluation.horizons.find((item) => item.settlement);
    assert.ok(horizon);
    if (!horizon) return;
    const at = analysisShareDelta(evaluation, id, horizon.id, 100);
    assert.equal(at, sampleStructureDelta(evaluation, id, horizon.id, 100, "shares", "delta"));
    assert.ok(at != null && Math.abs(at) > 100);
    const oneLot = spreadShareDelta(50, 55, 100, 0, 0.4);
    assert.notEqual(at, oneLot);

    const jointLab = load(joint.draft);
    const jointEval = evaluateLab(jointLab, chain);
    const jointHorizon = jointEval.horizons.find((item) => item.settlement)!;
    const jointDelta = analysisShareDelta(jointEval, jointLab.structures[0]!.id, jointHorizon.id, 200);
    const compositeHigh = analysisShareDelta(evaluation, id, horizon.id, 200);
    assert.equal(jointDelta, sampleStructureDelta(jointEval, jointLab.structures[0]!.id, jointHorizon.id, 200, "shares", "delta"));
    assert.notEqual(jointDelta, compositeHigh);
  });
});
