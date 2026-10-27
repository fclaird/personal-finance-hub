import assert from "node:assert/strict";
import test from "node:test";

import { createTickGate } from "@/lib/tickGate";

test("a tick still running skips the next one instead of stacking", async () => {
  const runExclusive = createTickGate();
  let started = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const first = runExclusive(async () => {
    started += 1;
    await gate;
  });
  const second = await runExclusive(async () => {
    started += 1;
  });
  assert.equal(second, false);
  assert.equal(started, 1);
  release();
  assert.equal(await first, true);
  assert.equal(
    await runExclusive(async () => {
      started += 1;
    }),
    true,
  );
  assert.equal(started, 2);
});
