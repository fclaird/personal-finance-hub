import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { NEWS_CACHE_MAX, rememberNewsCache } from "./newsCache";

describe("news rss cache", () => {
  it("drops expired entries and stays capped", () => {
    const store = new Map<string, { expiresAt: number; items: [] }>();
    for (let i = 0; i < 200; i++) {
      rememberNewsCache(store, `feed-${i}`, { expiresAt: 1_000 + i, items: [] }, 500, NEWS_CACHE_MAX);
    }
    assert.equal(store.size, NEWS_CACHE_MAX);
    rememberNewsCache(store, "stale", { expiresAt: 10, items: [] }, 0, NEWS_CACHE_MAX);
    rememberNewsCache(store, "fresh", { expiresAt: 500, items: [] }, 100, NEWS_CACHE_MAX);
    assert.equal(store.has("stale"), false);
    assert.equal(store.has("fresh"), true);
    assert.ok(store.size <= NEWS_CACHE_MAX);
  });
});
