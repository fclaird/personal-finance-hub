import assert from "node:assert/strict";
import test from "node:test";

import { evictOldestQuoteCache } from "@/lib/schwab/quotesFetch";

test("quote cache drops the oldest symbols once it passes the cap", () => {
  const cache = new Map<string, { at: number }>();
  for (let i = 0; i < 5; i++) cache.set(`S${i}`, { at: i });
  evictOldestQuoteCache(cache, 3);
  assert.deepEqual([...cache.keys()], ["S2", "S3", "S4"]);
});
