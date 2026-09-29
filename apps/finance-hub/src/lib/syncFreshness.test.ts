import assert from "node:assert/strict";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { oncePerPageOpen } from "@/lib/pageOpenSync";
import { SYNC_STAMP, syncShouldRun } from "@/lib/syncFreshness";
import { claimSync, readSyncStamp, recordSyncStamp } from "@/lib/syncStamp";

const NOW = Date.parse("2026-09-29T18:00:00.000Z");
const INSIDE = "2026-09-29T17:30:00.000Z";
const ON_WINDOW = "2026-09-29T12:00:00.000Z";
const PAST = "2026-09-29T11:59:59.999Z";

describe("syncShouldRun", () => {
  it("skips inside the 6h window, including the boundary, and runs when older, missing, or forced", () => {
    assert.equal(syncShouldRun({ force: false, lastSuccessAt: INSIDE, nowMs: NOW }), false);
    assert.equal(syncShouldRun({ force: false, lastSuccessAt: ON_WINDOW, nowMs: NOW }), false);
    assert.equal(syncShouldRun({ force: false, lastSuccessAt: PAST, nowMs: NOW }), true);
    assert.equal(syncShouldRun({ force: false, lastSuccessAt: null, nowMs: NOW }), true);
    assert.equal(syncShouldRun({ force: false, lastSuccessAt: "not-a-timestamp", nowMs: NOW }), true);
    assert.equal(syncShouldRun({ force: true, lastSuccessAt: INSIDE, nowMs: NOW }), true);
  });

  it("keeps a fresh holdings stamp from skipping a stale greeks stamp", () => {
    const db = new Database(":memory:");
    recordSyncStamp(db, SYNC_STAMP.schwabHoldings, INSIDE);
    recordSyncStamp(db, SYNC_STAMP.schwabGreeks, PAST);
    assert.equal(claimSync(db, SYNC_STAMP.schwabHoldings, false, NOW), "skip");
    assert.equal(claimSync(db, SYNC_STAMP.schwabGreeks, false, NOW), "run");
    assert.equal(claimSync(db, SYNC_STAMP.schwabHoldings, true, NOW), "run");
    assert.equal(readSyncStamp(db, SYNC_STAMP.dividendsLive), null);
    assert.equal(claimSync(db, SYNC_STAMP.dividendsLive, false, NOW), "run");
  });
});

describe("oncePerPageOpen", () => {
  it("shares one in-flight task and allows a later open to run again", async () => {
    let calls = 0;
    const task = () =>
      new Promise<number>((resolve) => {
        calls += 1;
        setTimeout(() => resolve(calls), 15);
      });
    const [a, b] = await Promise.all([oncePerPageOpen("unit.open", task), oncePerPageOpen("unit.open", task)]);
    assert.equal(calls, 1);
    assert.equal(a, 1);
    assert.equal(b, 1);
    const c = await oncePerPageOpen("unit.open", task);
    assert.equal(calls, 2);
    assert.equal(c, 2);
  });
});
