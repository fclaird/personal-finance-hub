import assert from "node:assert/strict";
import test from "node:test";

import { POSITIONS_COLUMN_DEFAULT_ORDER } from "./positionsColumnOrder";

test("positions default order includes symbol page syntheticShares column", () => {
  assert.ok(POSITIONS_COLUMN_DEFAULT_ORDER.includes("syntheticShares"));
  assert.ok(POSITIONS_COLUMN_DEFAULT_ORDER.includes("account"));
});
