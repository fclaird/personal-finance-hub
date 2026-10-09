import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { LAB_PALETTE } from "@/lib/strategyLab/palette";

describe("strategy lab dark palette", () => {
  it("uses bright series colors and a light stock line", () => {
    assert.deepEqual(LAB_PALETTE.series, ["#4ade80", "#22d3ee", "#fbbf24", "#e879f9"]);
    assert.equal(LAB_PALETTE.stock, "#d4d4d8");
    assert.ok(LAB_PALETTE.line >= 2.5);
    assert.ok(LAB_PALETTE.zoneOpacity >= 0.25);
    assert.notEqual(LAB_PALETTE.axis.toLowerCase(), "#666666");
  });
});
