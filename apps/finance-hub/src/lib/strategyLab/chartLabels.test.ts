import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { assignLabelLanes, breakevenReadout, peakReadout, type LabelBox } from "@/lib/strategyLab/chartLabels";

function box(id: string, left: number, top = 0, width = 80, height = 16, shift = 16): LabelBox {
  return { id, left, right: left + width, top, bottom: top + height, shift };
}

describe("chart label lanes", () => {
  it("keeps separated labels on the first lane", () => {
    const placed = assignLabelLanes([box("a", 0), box("b", 200)]);
    assert.deepEqual(
      placed.map((item) => [item.id, item.lane, item.hidden]),
      [
        ["a", 0, false],
        ["b", 0, false],
      ],
    );
  });

  it("staggers labels that share the same horizontal span", () => {
    const placed = assignLabelLanes([box("a", 10), box("b", 20), box("c", 400)]);
    const byId = new Map(placed.map((item) => [item.id, item]));
    assert.equal(byId.get("a")?.lane, 0);
    assert.equal(byId.get("b")?.lane, 1);
    assert.equal(byId.get("b")?.hidden, false);
    assert.equal(byId.get("c")?.lane, 0);
  });

  it("leaves a label on the first lane when it only overlaps in x and sits far away in y", () => {
    const placed = assignLabelLanes([box("high", 10, 40), box("low", 12, 240)]);
    assert.ok(placed.every((item) => item.lane === 0 && !item.hidden));
  });

  it("hides a label once every lane is taken", () => {
    const placed = assignLabelLanes([box("a", 0), box("b", 4), box("c", 8)], 2);
    const hidden = placed.filter((item) => item.hidden).map((item) => item.id);
    assert.deepEqual(hidden, ["c"]);
    assert.equal(placed.filter((item) => !item.hidden).length, 2);
  });

  it("returns placements in input order", () => {
    const placed = assignLabelLanes([box("z", 300), box("a", 0)]);
    assert.deepEqual(
      placed.map((item) => item.id),
      ["z", "a"],
    );
  });
});

describe("chart readouts", () => {
  it("names a peak with the delta and the price", () => {
    assert.equal(peakReadout("Call debit spread (6)", "83.5", 504.85), "Call debit spread (6): max delta 83.5 at $504.85");
  });

  it("names a breakeven with the structure and the price", () => {
    assert.equal(breakevenReadout("Call debit spread (2)", 162.35), "Call debit spread (2): breakeven at $162.35");
  });
});
