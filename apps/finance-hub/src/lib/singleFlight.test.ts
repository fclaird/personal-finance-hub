import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createSingleFlight } from "./singleFlight";

describe("createSingleFlight", () => {
  it("runs the function once while a hundred callers wait", async () => {
    let calls = 0;
    let release: () => void = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const flight = createSingleFlight<number>();
    const pending = Array.from({ length: 100 }, () =>
      flight.run(async () => {
        calls += 1;
        await gate;
        return 7;
      }),
    );
    assert.equal(flight.started, 1);
    assert.equal(flight.pending, true);
    await Promise.resolve();
    assert.equal(calls, 1);
    release();
    const values = await Promise.all(pending);
    assert.deepEqual(values, Array.from({ length: 100 }, () => 7));
    assert.equal(calls, 1);
    assert.equal(flight.pending, false);

    await flight.run(async () => 8);
    assert.equal(flight.started, 2);
  });
});
