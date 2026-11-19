import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { boundCacheSet } from "./cacheBound";

describe("boundCacheSet", () => {
  it("keeps a fixed number of entries after a long stream of distinct keys", () => {
    const map = new Map<string, { n: number }>();
    const max = 1000;
    for (let i = 0; i < 20_000; i++) boundCacheSet(map, `SYM${i}`, { n: i }, max);
    assert.equal(map.size, max);
    assert.equal(map.has("SYM0"), false);
    assert.equal(map.get("SYM19999")?.n, 19999);
    assert.equal(map.get("SYM19000")?.n, 19000);
  });

  it("refreshes recency without growing when the same key is updated", () => {
    const map = new Map<string, number>();
    boundCacheSet(map, "A", 1, 2);
    boundCacheSet(map, "B", 2, 2);
    boundCacheSet(map, "A", 3, 2);
    boundCacheSet(map, "C", 4, 2);
    assert.equal(map.size, 2);
    assert.equal(map.has("B"), false);
    assert.equal(map.get("A"), 3);
    assert.equal(map.get("C"), 4);
  });
});
