import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { paddedPriceSpan } from "@/lib/strategyLab/chartView";
import { calendarDaysBetween, formatExpiryLabel, isoDate, makeOptionChain, type ChainDraft, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { forwardDateSteps, forwardStepLabel } from "@/lib/strategyLab/dateSteps";
import { bsmGreeks } from "@/lib/options/blackScholes";
import { sampleStructureDelta } from "@/lib/strategyLab/deltaCurves";
import { createLab, editLab, evaluateLab, zeroPackageNotice, type HorizonView, type LabEvaluation, type PricedStructure } from "@/lib/strategyLab/lab";
import {
  applyCurveLook,
  applyHorizonPolicy,
  CHART_MODES,
  combinedDateCurves,
  crossoverCallouts,
  dateRampColor,
  displayedCurves,
  EXPIRY_RAMP_COLOR,
  positiveCrossovers,
  structurePanelCurves,
  defaultChartChrome,
  everyNthHorizonIds,
  initialChartSelection,
  parseChartSettings,
  rainbowColor,
  readableHorizonIds,
  reconcileChartSelection,
  shortHorizon,
  selectDate,
  setChartMode,
  setHorizons,
  setStructures,
  toggleStructure,
  visibleCurves,
  writeChartSettings,
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

  it("paints every forward date step of the focus structure on a cool-to-warm ramp", () => {
    const curves = visibleCurves(ev, initial);
    assert.deepEqual(
      curves.map((curve) => curve.horizonId),
      zebra.curves.map((curve) => curve.horizonId),
    );
    assert.ok(curves.every((curve) => curve.structureId === zebra.spec.id));
    assert.equal(curves[0]!.name, "Today");
    assert.equal(curves[curves.length - 1]!.name, "Expiry");
    assert.equal(curves[0]!.color, dateRampColor(0));
    assert.equal(curves[curves.length - 1]!.color, EXPIRY_RAMP_COLOR);
    assert.ok(curves[curves.length - 1]!.width > curves[0]!.width);
    assert.equal(curves[0]!.dash, undefined);
    const colors = curves.map((curve) => curve.color);
    assert.equal(new Set(colors).size, colors.length);
    const steps = curves.slice(0, -1).map((curve) => curve.color);
    for (let i = 1; i < steps.length; i++) assert.notEqual(steps[i - 1], steps[i]);
  });

  it("keeps one color per date after the structure look that used to collapse them", () => {
    const look = { colorMode: "structure" as const, stroke: "solid" as const, thickness: 3 };
    const painted = visibleCurves(ev, initial);
    const collapsed = applyCurveLook(painted, look, ev);
    assert.ok(painted.length > 1);
    assert.equal(new Set(collapsed.map((curve) => curve.color)).size, 1);
    assert.ok(collapsed.every((curve) => curve.dash == null));
    const shown = displayedCurves(ev, initial, look);
    assert.equal(new Set(shown.map((curve) => curve.color)).size, shown.length);
    assert.equal(shown[shown.length - 1]!.color, EXPIRY_RAMP_COLOR);
    assert.ok(shown[shown.length - 1]!.width > shown[0]!.width);
  });

  it("moves the waterfall to the structure turned on last", () => {
    const next = toggleStructure(toggleStructure(initial, zebra.spec.id), zebra.spec.id);
    assert.equal(next.focusStructureId, zebra.spec.id);
    assert.equal(idsOf(next, ev, zebra.spec.id).length, zebra.curves.length);
    assert.deepEqual(idsOf(next, ev, spread.spec.id), []);
    const cleared = setStructures(initial, [spread.spec.id]);
    assert.deepEqual(
      visibleCurves(ev, setChartMode(cleared, "waterfall")).map((curve) => curve.structureId),
      spread.curves.map(() => spread.spec.id),
    );
  });

  it("replaces the date when a second date is picked", () => {
    const first = setChartMode(initial, "single");
    assert.equal(first.mode, "single");
    assert.equal(first.horizonIds.length, 1);
    assert.equal(first.focusHorizonId, first.horizonIds[0]);
    const second = selectDate(first, expiry!.id, ev.horizons);
    assert.deepEqual(second.horizonIds, [expiry!.id]);
    assert.equal(second.focusHorizonId, expiry!.id);
    assert.equal(second.horizonIds.length, 1);
    const curves = visibleCurves(ev, second);
    assert.ok(curves.length > 0);
    assert.ok(curves.every((curve) => curve.horizonId === expiry!.id));
    assert.equal(new Set(curves.map((curve) => curve.horizonId)).size, 1);
    const replaced = selectDate(second, today!.id, ev.horizons);
    assert.deepEqual(replaced.horizonIds, [today!.id]);
    assert.ok(!replaced.horizonIds.includes(expiry!.id));
    const again = visibleCurves(ev, replaced);
    assert.ok(again.every((curve) => curve.horizonId === today!.id));
    assert.deepEqual(
      again.map((curve) => curve.structureId),
      [zebra.spec.id, spread.spec.id],
    );
  });

  it("numbers crossover callouts in spot order with readable text", () => {
    const curves = visibleCurves(ev, selectDate(initial, expiry!.id, ev.horizons));
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
    const profit = positiveCrossovers(ev, curves);
    assert.ok(profit.length > 0);
    assert.ok(profit.length <= callouts.length);
    for (const hit of profit) {
      assert.ok(hit.pnl > 0);
      assert.ok(callouts.some((callout) => Math.abs(callout.spot - hit.spot) < 1e-4));
    }
    const span = paddedPriceSpan(profit.map((hit) => hit.spot));
    assert.ok(span);
    const axisLo = ev.axis[0]!;
    const axisHi = ev.axis.at(-1)!;
    assert.ok(span.min >= axisLo - 1);
    assert.ok(span.max <= axisHi + 1 || span.max < axisHi);
    assert.ok(span.min <= Math.min(...profit.map((hit) => hit.spot)));
    assert.ok(span.max >= Math.max(...profit.map((hit) => hit.spot)));
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

  it("keeps a readable set of dates to today, a few quarters, and expiry", () => {
    const horizons = quarterHorizons(11);
    const ids = readableHorizonIds(horizons);
    assert.ok(ids.length <= 5);
    assert.equal(ids[0], horizons[0]!.id);
    assert.equal(ids[ids.length - 1], horizons[10]!.id);
    const everyFourth = everyNthHorizonIds(horizons, 4);
    assert.ok(everyFourth.includes(horizons[10]!.id));
    assert.deepEqual(applyHorizonPolicy(horizons, { kind: "every", step: 4 }, null).at(-1), horizons[10]!.id);
    const modeIds = CHART_MODES.map((mode) => mode.id as string);
    assert.deepEqual(modeIds, ["waterfall", "single"]);
    assert.equal(modeIds.includes("quarters"), false);
    assert.equal(modeIds.includes("custom"), false);
    assert.equal(modeIds.includes("overlay"), false);
  });

  it("restyles a single date from thickness, dash, and color", () => {
    const curves = visibleCurves(ev, selectDate(initial, expiry!.id, ev.horizons));
    const styled = applyCurveLook(curves, { colorMode: "rainbow", stroke: "dashed", thickness: 2 }, ev);
    assert.equal(styled.length, curves.length);
    assert.equal(styled[0]?.width, 3);
    assert.equal(styled[0]?.dash, undefined);
    if (styled.length > 1) assert.notEqual(styled[0]?.color, styled[1]?.color);
  });
});

function quarterHorizons(count: number): HorizonView[] {
  return Array.from({ length: count }, (_, index) => ({
    id: `h${index}`,
    date: `2026-${String((index % 12) + 1).padStart(2, "0")}-15`,
    label: index === count - 1 ? "Expiry · end" : index === 0 ? "Today · start" : `+${index * 3} mo · step`,
    shared: true,
    settlement: index === count - 1,
    structureId: null,
  }));
}

describe("waterfall date series", () => {
  it("builds one curve for every forward date step from today through expiry", () => {
    const built = makeOptionChain(
      draft([
        { expiry: "2028-01-21", right: "C", strike: 100, bid: 20, ask: 24, feedIv: null, multiplier: 100, root: null, openInterest: 10, volume: 4 },
      ]),
    );
    if (!built.ok) throw new Error(built.error);
    const chain = { ...built.chain, spot: 100 };
    const ev = evaluateLab(
      editLab(
        createLab(chain),
        [
          { kind: "setAssumptions", patch: { rate: 0.04, dividendYield: 0, ivSource: "mid" } },
          { kind: "setBasis", basis: { kind: "perPackage" } },
          { kind: "addStructure", label: "Leap", expiry: isoDate("2028-01-21"), request: { template: "longCall", strike: { by: "strike", strike: 100 } } },
        ],
        chain,
      ),
      chain,
    );
    const schedule = forwardDateSteps(isoDate("2026-10-08"), isoDate("2028-01-21"));
    assert.deepEqual(
      ev.horizons.map((horizon) => horizon.date),
      schedule.map((step) => step.date),
    );
    assert.equal(ev.horizons.at(-1)?.settlement, true);
    const curves = visibleCurves(ev, initialChartSelection(ev));
    assert.deepEqual(
      curves.map((curve) => curve.horizonId),
      ev.horizons.map((horizon) => horizon.id),
    );
    assert.deepEqual(
      curves.map((curve) => curve.name),
      schedule.map((step) => shortHorizon(forwardStepLabel(step, false))),
    );
    assert.ok(curves.some((curve) => curve.name.startsWith("E−2wk")));
    assert.equal(new Set(curves.map((curve) => curve.color)).size, curves.length);
    assert.equal(curves[0]!.color, dateRampColor(0));
    assert.equal(curves.at(-2)!.color, dateRampColor(1));
    assert.notEqual(curves[1]!.color, curves[0]!.color);
    assert.equal(curves.at(-1)!.color, EXPIRY_RAMP_COLOR);
    assert.ok(curves.at(-1)!.width >= curves[0]!.width + 1);
    const picked = selectDate(initialChartSelection(ev), ev.horizons[2]!.id, ev.horizons);
    assert.deepEqual(picked.horizonIds, [ev.horizons[2]!.id]);
    assert.equal(visibleCurves(ev, picked).length, 1);
    assert.equal(visibleCurves(ev, selectDate(picked, ev.horizons[4]!.id, ev.horizons)).length, 1);
  });
});

describe("ZEBRA zero packages", () => {
  const chain = expensiveChain();
  const whole = evaluateLab(
    editLab(
      createLab(chain),
      [
        { kind: "setAssumptions", patch: { rate: 0.04, dividendYield: 0, ivSource: "mid" } },
        { kind: "setBasis", basis: { kind: "equalCapital", capital: 10_000, units: "whole" } },
        {
          kind: "addStructure",
          label: "ZEBRA",
          expiry: isoDate(EXPIRY),
          request: { template: "zebra", long: { by: "strike", strike: 400 }, short: { by: "strike", strike: 520 } },
        },
      ],
      chain,
    ),
    chain,
  );
  const row = whole.structures.find((item) => item.spec.label === "ZEBRA");

  it("does not draw a flat zero line when one ZEBRA package costs more than $10,000", () => {
    assert.ok(row && row.status === "priced");
    if (!row || row.status !== "priced") return;
    assert.equal(row.sizing.status, "sized");
    if (row.sizing.status !== "sized") return;
    assert.equal(row.sizing.packages, 0);
    assert.ok(row.curves.length > 0);
    assert.ok(row.curves.every((curve) => curve.points.every((point) => point.pnl === 0)));
    assert.equal(visibleCurves(whole, initialChartSelection(whole)).length, 0);
    const selection = initialChartSelection(whole);
    assert.equal(structurePanelCurves(whole, selection, row.spec.id).length, 0);
    assert.equal(combinedDateCurves(whole, selection).length, 0);
    const notice = whole.issues.find((issue) => issue.code === "below-one-package")?.message ?? "";
    assert.equal(notice, zeroPackageNotice("ZEBRA", 10_000, row.risk.maxLoss === "unbounded" ? null : row.risk.maxLoss));
    assert.match(notice, /ZEBRA: 0 packages on \$10,000 \(package costs \$/);
    assert.match(notice, /raise capital or use fractional units/);
  });

  it("draws the expensive ZEBRA once the match basis sizes it to one package", () => {
    const matched = evaluateLab(
      editLab(
        createLab(chain),
        [
          { kind: "setAssumptions", patch: { rate: 0.04, dividendYield: 0, ivSource: "mid" } },
          {
            kind: "addStructure",
            label: "ZEBRA",
            expiry: isoDate(EXPIRY),
            request: { template: "zebra", long: { by: "strike", strike: 400 }, short: { by: "strike", strike: 520 } },
          },
          {
            kind: "addStructure",
            label: "Spread",
            expiry: isoDate(EXPIRY),
            request: { template: "callDebitSpread", long: { by: "strike", strike: 400 }, short: { by: "strike", strike: 520 } },
          },
        ],
        chain,
      ),
      chain,
    );
    const zebraRow = matched.structures.find((item) => item.spec.label === "ZEBRA");
    const spreadRow = matched.structures.find((item) => item.spec.label === "Spread");
    assert.ok(zebraRow && zebraRow.status === "priced" && spreadRow && spreadRow.status === "priced");
    if (!zebraRow || zebraRow.status !== "priced" || zebraRow.sizing.status !== "sized") return;
    if (!spreadRow || spreadRow.status !== "priced" || spreadRow.sizing.status !== "sized") return;
    assert.equal(matched.basis.kind, "matchExpensive");
    assert.equal(zebraRow.sizing.packages, 1);
    assert.equal(zebraRow.sizing.idleCash, 0);
    assert.ok(spreadRow.sizing.packages > 0);
    const pnl = zebraRow.curves.flatMap((curve) => curve.points.map((point) => point.pnl));
    assert.ok(pnl.some((value) => Math.abs(value) > 1));
    const selection = initialChartSelection(matched);
    const panel = structurePanelCurves(matched, selection, zebraRow.spec.id);
    assert.ok(panel.length > 0);
    assert.ok(panel.every((curve) => curve.structureId === zebraRow.spec.id));
    const combined = combinedDateCurves(matched, selection);
    assert.deepEqual(
      combined.map((curve) => curve.structureId).sort(),
      [spreadRow.spec.id, zebraRow.spec.id].sort(),
    );
    assert.equal(new Set(combined.map((curve) => curve.horizonId)).size, 1);
  });

  it("plots a non-zero ZEBRA once units are fractional", () => {
    const fractional = evaluateLab(
      editLab(createLab(chain), [
        { kind: "setAssumptions", patch: { rate: 0.04, dividendYield: 0, ivSource: "mid" } },
        { kind: "setBasis", basis: { kind: "equalCapital", capital: 10_000, units: "fractional" } },
        {
          kind: "addStructure",
          label: "ZEBRA",
          expiry: isoDate(EXPIRY),
          request: { template: "zebra", long: { by: "strike", strike: 400 }, short: { by: "strike", strike: 520 } },
        },
      ], chain),
      chain,
    );
    const pricedRow = fractional.structures.find((item) => item.spec.label === "ZEBRA");
    assert.ok(pricedRow && pricedRow.status === "priced");
    if (!pricedRow || pricedRow.status !== "priced" || pricedRow.sizing.status !== "sized") return;
    assert.ok(pricedRow.sizing.packages > 0);
    assert.ok(pricedRow.curves.length > 0);
    const pnl = pricedRow.curves.flatMap((curve) => curve.points.map((point) => point.pnl));
    assert.ok(pnl.some((value) => Math.abs(value) > 1));
    const curves = visibleCurves(fractional, initialChartSelection(fractional));
    assert.ok(curves.some((curve) => curve.structureId === pricedRow.spec.id));
  });
});

function expensiveChain(): OptionChain {
  const built = makeOptionChain(
    draft([
      contract("C", 400, 120, 130),
      contract("C", 520, 30, 40),
    ]),
  );
  if (!built.ok) throw new Error(built.error);
  return { ...built.chain, spot: 450, symbol: "NOW" };
}

describe("chart settings parser", () => {
  it("rejects a bad blob and round-trips a valid one", () => {
    assert.equal(parseChartSettings(null), null);
    assert.equal(parseChartSettings({ v: 2 }), null);
    assert.equal(parseChartSettings({ v: 1, mode: "grid", horizonPolicy: { kind: "readable" }, chrome: defaultChartChrome() }), null);
    const chrome = { ...defaultChartChrome(), thickness: 3.5, yAxis: { kind: "manual" as const, min: -500, max: 8000 } };
    const settings = { mode: "waterfall" as const, horizonPolicy: { kind: "every" as const, step: 2 as const }, chrome };
    const opened = parseChartSettings({ v: 1, mode: "quarters", horizonPolicy: settings.horizonPolicy, chrome });
    assert.equal(opened?.mode, "waterfall");
    assert.deepEqual(opened?.horizonPolicy, settings.horizonPolicy);
    assert.deepEqual(parseChartSettings({ v: 1, ...settings }), settings);
    assert.equal(parseChartSettings({ v: 1, ...settings, chrome: { ...chrome, thickness: 0 } }), null);
    const savedOverlay = parseChartSettings({
      v: 1,
      mode: "overlay",
      horizonPolicy: { kind: "every", step: 2 },
      chrome: { ...chrome, colorMode: "rainbow" },
    });
    assert.equal(savedOverlay?.mode, "single");
    assert.deepEqual(savedOverlay?.horizonPolicy, { kind: "every", step: 2 });
    assert.equal(savedOverlay?.chrome.thickness, 3.5);
    assert.equal(savedOverlay?.chrome.colorMode, "rainbow");
    assert.equal(parseChartSettings({ v: 1, mode: "custom", horizonPolicy: { kind: "all" }, chrome })?.mode, "waterfall");
    assert.equal(parseChartSettings({ v: 1, mode: "expiry", horizonPolicy: { kind: "readable" }, chrome })?.mode, "single");
    assert.doesNotThrow(() => parseChartSettings({ v: 1, mode: "overlay", horizonPolicy: null, chrome: "nope" }));
    const mem = new Map<string, string>();
    const storage = {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mem.set(key, value);
      },
    };
    writeChartSettings(storage, settings);
    assert.deepEqual(parseChartSettings(JSON.parse(mem.values().next().value ?? "null")), settings);
  });
});

describe("structures with different expiries", () => {
  const near = "2027-01-15";
  const far = "2028-01-21";
  const built = makeOptionChain({
    symbol: "NOW",
    spot: 100,
    tradeDate: "2026-10-08",
    quoteTime: null,
    source: "cboe",
    delayed: true,
    dividendYieldHint: 0,
    contracts: [
      { expiry: near, right: "C", strike: 100, bid: 5.5, ask: 6.5, feedIv: null, multiplier: 100, root: null, openInterest: 1, volume: 1 },
      { expiry: far, right: "C", strike: 100, bid: 12, ask: 15, feedIv: null, multiplier: 100, root: null, openInterest: 1, volume: 1 },
    ],
    fetchedAt: "2026-10-08T16:00:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
  });
  if (!built.ok) throw new Error(built.error);

  const ev = evaluateLab(
    editLab(
      createLab(built.chain),
      [
        { kind: "setAssumptions", patch: { rate: 0, dividendYield: 0, ivSource: "mid" } },
        { kind: "setBasis", basis: { kind: "perPackage" } },
        { kind: "addStructure", label: "Near", expiry: isoDate(near), request: { template: "longCall", strike: { by: "strike", strike: 100 } } },
        { kind: "addStructure", label: "Far", expiry: isoDate(far), request: { template: "longCall", strike: { by: "strike", strike: 100 } } },
      ],
      built.chain,
    ),
    built.chain,
  );

  it("uses each structure's own time to expiry on a shared date, on a schedule ending at the later expiry", () => {
    const today = ev.horizons.find((horizon) => horizon.date === ev.entryDate && !horizon.settlement);
    assert.ok(today);
    const rows = ["Near", "Far"].map((label) => {
      const row = ev.structures.find((item) => item.spec.label === label);
      assert.ok(row && row.status === "priced");
      if (!row || row.status !== "priced") throw new Error("unreachable");
      return row;
    });
    const [nearRow, farRow] = rows;
    assert.ok(nearRow && farRow && today);
    const expected = (row: PricedStructure) => {
      const years = calendarDaysBetween(today!.date, row.spec.expiry) / 365;
      const iv = row.legs[0]?.iv;
      assert.ok(iv != null && years > 0);
      if (iv == null) throw new Error("unreachable");
      return bsmGreeks({ right: "C", spot: 100, strike: 100, years, rate: 0.04, dividendYield: 0, vol: iv }).delta * 100;
    };
    const nearDelta = sampleStructureDelta(ev, nearRow.spec.id, today.id, 100, "shares", "delta");
    const farDelta = sampleStructureDelta(ev, farRow.spec.id, today.id, 100, "shares", "delta");
    assert.ok(nearDelta != null && farDelta != null);
    assert.ok(Math.abs(nearDelta - expected(nearRow)) < 1e-6);
    assert.ok(Math.abs(farDelta - expected(farRow)) < 1e-6);
    assert.notEqual(calendarDaysBetween(today.date, nearRow.spec.expiry), calendarDaysBetween(today.date, farRow.spec.expiry));

    const schedule = forwardDateSteps(isoDate("2026-10-08"), isoDate(far));
    assert.deepEqual(
      ev.horizons.map((horizon) => horizon.date),
      schedule.map((step) => step.date),
    );
    assert.ok(ev.horizons.every((horizon) => horizon.shared && horizon.structureId == null));
    assert.equal(ev.horizons.at(-1)?.date, isoDate(far));
    assert.ok(ev.horizons.some((horizon) => horizon.label.includes(" · ")));
    const expiry = ev.horizons.at(-1);
    assert.ok(expiry?.settlement);
    const expiryCurves = visibleCurves(ev, selectDate(initialChartSelection(ev), expiry!.id, ev.horizons));
    assert.equal(expiryCurves.length, 2);
    assert.ok(expiryCurves.every((curve) => curve.horizonId === expiry!.id));
    for (const row of rows) {
      const curve = expiryCurves.find((item) => item.structureId === row.spec.id);
      assert.match(curve?.name ?? "", /expiry/);
    }
  });
});

describe("duplicate structure names", () => {
  it("numbers the second ZEBRA and keeps series keys unique", () => {
    const chain = chainOf();
    const zebra = {
      kind: "addStructure" as const,
      label: "ZEBRA",
      expiry: isoDate(EXPIRY),
      request: {
        template: "zebra" as const,
        long: { by: "strike" as const, strike: 140 },
        short: { by: "strike" as const, strike: 160 },
      },
    };
    const ev = evaluateLab(editLab(createLab(chain), [zebra, zebra], chain), chain);
    const today = ev.horizons.find((horizon) => horizon.date === ev.entryDate && !horizon.settlement);
    assert.ok(today);
    const curves = visibleCurves(ev, selectDate(initialChartSelection(ev), today.id, ev.horizons));
    const names = curves.map((curve) => curve.name);
    assert.ok(names.includes("ZEBRA"));
    assert.ok(names.includes("ZEBRA (2)"));
    assert.equal(new Set(curves.map((curve) => curve.key)).size, curves.length);
    assert.ok(curves.every((curve) => curve.key.startsWith(`${curve.structureId}@@`)));
  });
});
