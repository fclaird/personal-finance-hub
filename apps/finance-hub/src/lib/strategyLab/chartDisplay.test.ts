import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isoDate, makeOptionChain, type ChainDraft, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { createLab, editLab, evaluateLab, type LabEvaluation, type PricedStructure } from "@/lib/strategyLab/lab";
import {
  crossoverCallouts,
  initialChartSelection,
  rainbowColor,
  reconcileChartSelection,
  setChartMode,
  setHorizons,
  setStructures,
  toggleStructure,
  visibleCurves,
  type ChartSelection,
} from "@/lib/strategyLab/chartDisplay";

const EXPIRY = "2027-01-15";

function draft(contracts: DraftContract[]): ChainDraft {
  return {
    symbol: "NOW",
    spot: 140,
    tradeDate: "2026-10-08",
    quoteTime: null,
    source: "cboe",
    delayed: true,
    dividendYieldHint: 0,
    contracts,
    fetchedAt: "2026-10-08T16:00:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
  };
}

function contract(right: "C" | "P", strike: number, bid: number, ask: number): DraftContract {
  return { expiry: EXPIRY, right, strike, bid, ask, feedIv: null, multiplier: 100, root: null, openInterest: 10, volume: 4 };
}

function chainOf(): OptionChain {
  const built = makeOptionChain(
    draft([
      contract("C", 140, 19, 21),
      contract("P", 140, 14, 16),
      contract("P", 120, 2, 2.4),
      contract("C", 160, 3, 3.4),
      contract("C", 150, 10, 12),
    ]),
  );
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

function evaluation(): LabEvaluation {
  const chain = chainOf();
  return evaluateLab(
    editLab(
      createLab(chain),
      [
        { kind: "setAssumptions", patch: { rate: 0.04, dividendYield: 0, ivSource: "mid" } },
        { kind: "setBasis", basis: { kind: "equalCapital", capital: 10_000, units: "whole" } },
        {
          kind: "addStructure",
          label: "ZEBRA",
          expiry: isoDate(EXPIRY),
          request: {
            template: "zebra",
            long: { by: "strike", strike: 140 },
            short: { by: "strike", strike: 160 },
          },
        },
      {
        kind: "addStructure",
        label: "Spread",
        expiry: isoDate(EXPIRY),
        request: {
          template: "callDebitSpread",
          long: { by: "strike", strike: 140 },
          short: { by: "strike", strike: 150 },
        },
      },
      ],
      chain,
    ),
    chain,
  );
}

function priced(label: string, ev: LabEvaluation): PricedStructure {
  const row = ev.structures.find((item) => item.spec.label === label);
  assert.ok(row && row.status === "priced");
  if (!row || row.status !== "priced") throw new Error("unreachable");
  return row;
}

function idsOf(selection: ChartSelection, ev: LabEvaluation, structureId: string): string[] {
  return visibleCurves(ev, selection)
    .filter((curve) => curve.structureId === structureId)
    .map((curve) => curve.horizonId);
}

describe("chart display selector", () => {
  const ev = evaluation();
  const zebra = priced("ZEBRA", ev);
  const spread = priced("Spread", ev);
  const initial = initialChartSelection(ev);
  const today = ev.horizons.find((horizon) => !horizon.settlement && horizon.date === ev.entryDate);
  const expiry = ev.horizons.find((horizon) => horizon.settlement);
  const middle = ev.horizons.find((horizon) => !horizon.settlement && horizon.date !== ev.entryDate);
  assert.ok(today && expiry && middle);

  it("starts on the waterfall with every structure and date selected", () => {
    assert.equal(initial.mode, "waterfall");
    assert.deepEqual(initial.structureIds, [zebra.spec.id, spread.spec.id]);
    assert.ok(initial.horizonIds.includes(today!.id));
    assert.ok(initial.horizonIds.includes(expiry!.id));
    assert.equal(initial.focusStructureId, zebra.spec.id);
    assert.equal(initial.focusHorizonId, middle!.id);
  });

  it("paints a rainbow for the focus structure and one expiry line for the rest", () => {
    const curves = visibleCurves(ev, initial);
    const zebraHorizons = idsOf(initial, ev, zebra.spec.id);
    assert.deepEqual(
      zebraHorizons,
      zebra.curves.map((curve) => curve.horizonId),
    );
    assert.deepEqual(idsOf(initial, ev, spread.spec.id), [expiry!.id]);
    const zebraCurves = curves.filter((curve) => curve.structureId === zebra.spec.id);
    const last = zebraCurves[zebraCurves.length - 1]!;
    assert.ok(last.width > zebraCurves[0]!.width);
    assert.notEqual(zebraCurves[0]!.color, last.color);
    assert.equal(zebraCurves[0]!.dash, undefined);
    const other = curves.find((curve) => curve.structureId === spread.spec.id);
    assert.equal(other?.dash, "8 4");
    assert.match(other?.name ?? "", /expiry/);
  });

  it("moves the rainbow to the structure turned on last", () => {
    const next = toggleStructure(toggleStructure(initial, zebra.spec.id), zebra.spec.id);
    assert.equal(next.focusStructureId, zebra.spec.id);
    assert.equal(idsOf(next, ev, zebra.spec.id).length, zebra.curves.length);
    assert.deepEqual(idsOf(next, ev, spread.spec.id), [expiry!.id]);
    const cleared = setStructures(initial, [spread.spec.id]);
    assert.deepEqual(
      visibleCurves(ev, setChartMode(cleared, "waterfall")).map((curve) => curve.structureId),
      spread.curves.map(() => spread.spec.id),
    );
  });

  it("shows only the quarters that are selected", () => {
    const selection = setChartMode(setHorizons(initial, [today!.id, expiry!.id]), "quarters");
    const curves = visibleCurves(ev, selection);
    assert.ok(curves.every((curve) => curve.horizonId === today!.id || curve.horizonId === expiry!.id));
    assert.equal(curves.filter((curve) => curve.structureId === zebra.spec.id).length, 2);
    assert.equal(curves.filter((curve) => curve.structureId === spread.spec.id).length, 2);
    const one = setStructures(selection, [zebra.spec.id]);
    const solo = visibleCurves(ev, one);
    assert.equal(solo.length, 2);
    assert.notEqual(solo[0]!.color, solo[1]!.color);
    assert.ok(solo[1]!.width > solo[0]!.width);
  });

  it("shows expiry curves only", () => {
    const curves = visibleCurves(ev, setChartMode(initial, "expiry"));
    assert.deepEqual(
      curves.map((curve) => curve.horizonId),
      [expiry!.id, expiry!.id],
    );
    assert.ok(curves.every((curve) => curve.width >= 4));
  });

  it("shows the trade-date curves only", () => {
    const curves = visibleCurves(ev, setChartMode(initial, "today"));
    assert.deepEqual(
      curves.map((curve) => curve.horizonId),
      [today!.id, today!.id],
    );
  });

  it("shows today, the chosen date, and expiry", () => {
    const curves = visibleCurves(ev, setChartMode(setStructures(initial, [zebra.spec.id]), "span"));
    assert.deepEqual(
      curves.map((curve) => curve.horizonId),
      [today!.id, middle!.id, expiry!.id],
    );
  });

  it("overlays every selected structure on one date", () => {
    const curves = visibleCurves(ev, setChartMode(initial, "dateOverlay"));
    assert.equal(curves.length, 2);
    assert.ok(curves.every((curve) => curve.horizonId === middle!.id));
    assert.deepEqual(
      curves.map((curve) => curve.structureId),
      [zebra.spec.id, spread.spec.id],
    );
  });

  it("clears and restores dates in custom mode", () => {
    const custom = setChartMode(initial, "custom");
    assert.equal(visibleCurves(ev, setHorizons(custom, [])).length, 0);
    const all = visibleCurves(ev, setHorizons(custom, ev.horizons.map((horizon) => horizon.id)));
    assert.equal(all.length, zebra.curves.length + spread.curves.length);
    assert.equal(visibleCurves(ev, setStructures(custom, [])).length, 0);
  });

  it("numbers crossover callouts in spot order with readable text", () => {
    const curves = visibleCurves(ev, setChartMode(initial, "expiry"));
    const callouts = crossoverCallouts(ev, curves);
    const board = ev.expiryBoards.find((item) => item.exact);
    assert.ok(board);
    const ids = new Set(curves.map((curve) => curve.structureId));
    const expected = board!.crossovers.filter((crossover) => ids.has(crossover.overtakesId) && ids.has(crossover.overtakenId));
    assert.equal(callouts.length, expected.length);
    assert.ok(callouts.length > 0);
    callouts.forEach((callout, index) => {
      assert.equal(callout.n, index + 1);
      assert.match(callout.text, /passes/);
      assert.equal(callout.model, false);
      assert.doesNotMatch(callout.text, /\n/);
    });
    for (let i = 1; i < callouts.length; i++) assert.ok(callouts[i - 1]!.spot <= callouts[i]!.spot);
    const waterfall = crossoverCallouts(ev, visibleCurves(ev, initial));
    assert.deepEqual(
      waterfall.map((callout) => callout.spot),
      callouts.map((callout) => callout.spot),
    );
  });

  it("keeps a cleared structure cleared until a new one arrives", () => {
    const cleared = setStructures(initial, [zebra.spec.id]);
    const same = reconcileChartSelection(
      cleared,
      { structures: initial.structureIds, horizons: initial.horizonIds },
      { structures: initial.structureIds, horizons: initial.horizonIds },
    );
    assert.deepEqual(same.structureIds, [zebra.spec.id]);
    const added = reconcileChartSelection(
      cleared,
      { structures: [...initial.structureIds, "new"], horizons: initial.horizonIds },
      { structures: initial.structureIds, horizons: initial.horizonIds },
    );
    assert.deepEqual(added.structureIds, [zebra.spec.id, "new"]);
    const droppedDate = setHorizons(initial, [expiry!.id]);
    const kept = reconcileChartSelection(
      droppedDate,
      { structures: initial.structureIds, horizons: initial.horizonIds },
      { structures: initial.structureIds, horizons: initial.horizonIds },
    );
    assert.deepEqual(kept.horizonIds, [expiry!.id]);
  });

  it("uses a bright rainbow with distinct ends", () => {
    const todayColor = rainbowColor(0);
    const expiryColor = rainbowColor(1);
    assert.match(todayColor, /^#[0-9a-f]{6}$/);
    assert.notEqual(todayColor, expiryColor);
    assert.notEqual(rainbowColor(0.5), todayColor);
  });
});
