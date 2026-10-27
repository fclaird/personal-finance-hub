import assert from "node:assert/strict";
import test from "node:test";

import { createSwrCache } from "@/lib/server/swrCache";

function block(ms: number) {
  const end = performance.now() + ms;
  while (performance.now() < end) {
    /* cpu-bound stand-in for the sqlite + Schwab work each uncached request used to repeat */
  }
}

test("fresh hit does not reload and concurrent misses share one load", async () => {
  let clock = 1_000;
  let calls = 0;
  const cache = createSwrCache<number>({
    freshMs: () => 1_000,
    staleMs: () => 5_000,
    now: () => clock,
  });
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const load = () =>
    gate.then(() => {
      calls += 1;
      return 7;
    });

  const first = cache.get("positions", load);
  const second = cache.get("positions", load);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.equal(a.value, 7);
  assert.equal(b.stale, false);
  assert.equal(a.asOf, b.asOf);

  const again = await cache.get("positions", load);
  assert.equal(calls, 1);
  assert.equal(again.stale, false);
  assert.equal(again.refreshing, false);
});

test("stale hit returns the previous value and refreshes once in the background", async () => {
  let clock = 10_000;
  let calls = 0;
  const cache = createSwrCache<number>({
    freshMs: () => 1_000,
    staleMs: () => 5_000,
    now: () => clock,
  });
  await cache.get("allocation", async () => {
    calls += 1;
    return 1;
  });
  clock += 1_500;
  const stale = await cache.get("allocation", async () => {
    calls += 1;
    return 2;
  });
  assert.equal(stale.stale, true);
  assert.equal(stale.refreshing, true);
  assert.equal(stale.value, 1);
  await cache.pending();
  assert.equal(calls, 2);
  const fresh = await cache.get("allocation", async () => {
    calls += 1;
    return 3;
  });
  assert.equal(fresh.value, 2);
  assert.equal(fresh.stale, false);
  assert.equal(calls, 2);
});

test("force waits for a new load", async () => {
  let clock = 0;
  let calls = 0;
  const cache = createSwrCache<string>({
    freshMs: () => 60_000,
    staleMs: () => 60_000,
    now: () => clock,
  });
  await cache.get("k", async () => {
    calls += 1;
    return "old";
  });
  const next = await cache.get(
    "k",
    async () => {
      calls += 1;
      return "new";
    },
    true,
  );
  assert.equal(calls, 2);
  assert.equal(next.value, "new");
  assert.equal(next.stale, false);
});

test("repeat reads are cheaper than running the loader every time", async () => {
  const workMs = 12;
  const n = 8;
  const cache = createSwrCache<number>({
    freshMs: () => 60_000,
    staleMs: () => 60_000,
    now: () => 0,
  });
  const load = async () => {
    block(workMs);
    return 1;
  };

  const uncachedStart = performance.now();
  await Promise.all(Array.from({ length: n }, () => load()));
  const uncachedMs = performance.now() - uncachedStart;

  await cache.get("book", load);
  const cachedStart = performance.now();
  await Promise.all(Array.from({ length: n }, () => cache.get("book", load)));
  const cachedMs = performance.now() - cachedStart;

  const deduped = createSwrCache<number>({
    freshMs: () => 60_000,
    staleMs: () => 60_000,
    now: () => 0,
  });
  const dedupedStart = performance.now();
  await Promise.all(Array.from({ length: n }, () => deduped.get("book", load)));
  const dedupedMs = performance.now() - dedupedStart;

  console.log(
    `BENCH portfolio-cache n=${n} workMs=${workMs} uncachedParallelMs=${uncachedMs.toFixed(1)} dedupedParallelMs=${dedupedMs.toFixed(1)} freshHitParallelMs=${cachedMs.toFixed(1)}`,
  );
  assert.ok(cachedMs < uncachedMs / 3, `fresh hits ${cachedMs}ms should be well under uncached ${uncachedMs}ms`);
  assert.ok(dedupedMs < uncachedMs / 2, `deduped ${dedupedMs}ms should be well under uncached ${uncachedMs}ms`);
});
