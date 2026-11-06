import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { seriesColor, LAB_PALETTE } from "@/lib/strategyLab/palette";
import { applyPlotAction, invertPlotIds, plotAll, plotNone, togglePlotId } from "@/lib/strategyLab/plotSelection";

const universe = ["a", "b", "c", "d", "e"];

describe("plot selection", () => {
  it("toggles one id, selects all, clears, and inverts in universe order", () => {
    assert.deepEqual(togglePlotId(["a", "c"], "b"), ["a", "c", "b"]);
    assert.deepEqual(togglePlotId(["a", "c"], "a"), ["c"]);
    assert.deepEqual(plotAll(universe), universe);
    assert.deepEqual(plotNone(), []);
    assert.deepEqual(invertPlotIds(["a", "e"], universe), ["b", "c", "d"]);
    assert.deepEqual(invertPlotIds([], universe), universe);
  });

  it("keeps a linked subset in sync and lets the charts diverge when unlinked", () => {
    const linked = { link: true, pnl: ["a", "b", "c"], delta: ["a", "b", "c"] };
    const dropped = applyPlotAction(linked, { kind: "toggle", chart: "delta", id: "b" });
    assert.deepEqual(dropped, { link: true, pnl: ["a", "c"], delta: ["a", "c"] });
    const none = applyPlotAction(dropped, { kind: "none", chart: "pnl" });
    assert.deepEqual(none.pnl, []);
    assert.deepEqual(none.delta, []);
    const several = applyPlotAction(none, { kind: "toggle", chart: "pnl", id: "d" });
    const unlinked = applyPlotAction(several, { kind: "link", on: false, universe });
    assert.equal(unlinked.link, false);
    assert.deepEqual(unlinked.pnl, ["d"]);
    assert.deepEqual(unlinked.delta, ["d"]);
    const onlyDelta = applyPlotAction(unlinked, { kind: "all", chart: "delta", universe });
    assert.deepEqual(onlyDelta.pnl, ["d"]);
    assert.deepEqual(onlyDelta.delta, universe);
    const relinked = applyPlotAction(onlyDelta, { kind: "link", on: true, universe });
    assert.equal(relinked.link, true);
    assert.deepEqual(relinked.pnl, universe);
    assert.deepEqual(relinked.delta, universe);
    const inverted = applyPlotAction(relinked, { kind: "invert", chart: "pnl", universe });
    assert.deepEqual(inverted.pnl, []);
    assert.deepEqual(inverted.delta, []);
  });

  it("adds a package to the overlay and can leave one package alone", () => {
    const start = { link: false, pnl: ["a"], delta: ["a", "b"] };
    const overlaid = applyPlotAction(start, { kind: "add", chart: "pnl", id: "c" });
    assert.deepEqual(overlaid.pnl, ["a", "c"]);
    assert.deepEqual(overlaid.delta, ["a", "b"]);
    const alone = applyPlotAction(overlaid, { kind: "only", chart: "pnl", id: "c" });
    assert.deepEqual(alone.pnl, ["c"]);
    assert.deepEqual(alone.delta, ["a", "b"]);
  });
});

describe("structure colors past four", () => {
  it("keeps the first four colors and gives at least eight slots distinct bright colors", () => {
    assert.deepEqual(LAB_PALETTE.series.slice(0, 4), ["#4ade80", "#22d3ee", "#fbbf24", "#e879f9"]);
    assert.ok(LAB_PALETTE.series.length >= 8);
    const colors = Array.from({ length: 16 }, (_, slot) => seriesColor(slot));
    assert.equal(new Set(colors.map((color) => color.toLowerCase())).size, colors.length);
    assert.equal(seriesColor(0), "#4ade80");
    assert.equal(seriesColor(7), seriesColor(7));
    for (const color of colors) {
      assert.match(color, /^#[0-9a-f]{6}$/i);
    }
  });
});