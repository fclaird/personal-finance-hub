import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { numbersDiffer } from "./valueEqual";

describe("numbersDiffer", () => {
  it("treats an identical close as unchanged", () => {
    assert.equal(numbersDiffer(143.64, 143.64), false);
    assert.equal(numbersDiffer(null, null), false);
  });

  it("treats a real price move as a write", () => {
    assert.equal(numbersDiffer(143.64, 143.7), true);
    assert.equal(numbersDiffer(null, 10), true);
    assert.equal(numbersDiffer(10, null), true);
  });
});
