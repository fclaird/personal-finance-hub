import assert from "node:assert/strict";
import test from "node:test";

import { symbolPerformanceItemId } from "@/lib/terminal/symbolPerformanceIntraday";

test("symbolPerformanceItemId preserves dotted ticker chart keys", () => {
  assert.equal(symbolPerformanceItemId({ id: "BRK.B" }), "BRK.B");
});
