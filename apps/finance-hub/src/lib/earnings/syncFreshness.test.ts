import assert from "node:assert/strict";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import {
  earningsFinnhubSyncShouldRun,
  readEarningsFinnhubSyncedAt,
  recordEarningsFinnhubSyncedAt,
} from "@/lib/earnings/syncFreshness";

const NOW = Date.parse("2026-09-29T18:00:00.000Z");
const ON_WINDOW = "2026-09-29T12:00:00.000Z";
const INSIDE_WINDOW = "2026-09-29T17:30:00.000Z";
const PAST_WINDOW = "2026-09-29T11:59:59.999Z";

describe("earningsFinnhubSyncShouldRun", () => {
  it("skips a stamp inside the 6h window, including the exact boundary, and runs when older, missing, or forced", () => {
    assert.equal(earningsFinnhubSyncShouldRun({ force: false, lastSuccessAt: INSIDE_WINDOW, nowMs: NOW }), false);
    assert.equal(earningsFinnhubSyncShouldRun({ force: false, lastSuccessAt: ON_WINDOW, nowMs: NOW }), false);
    assert.equal(earningsFinnhubSyncShouldRun({ force: false, lastSuccessAt: PAST_WINDOW, nowMs: NOW }), true);
    assert.equal(earningsFinnhubSyncShouldRun({ force: false, lastSuccessAt: null, nowMs: NOW }), true);
    assert.equal(earningsFinnhubSyncShouldRun({ force: false, lastSuccessAt: "not-a-timestamp", nowMs: NOW }), true);
    assert.equal(earningsFinnhubSyncShouldRun({ force: true, lastSuccessAt: INSIDE_WINDOW, nowMs: NOW }), true);
  });

  it("stores the last success and the next non-force decision follows that stamp", () => {
    const db = new Database(":memory:");
    assert.equal(readEarningsFinnhubSyncedAt(db), null);
    assert.equal(
      earningsFinnhubSyncShouldRun({ force: false, lastSuccessAt: readEarningsFinnhubSyncedAt(db), nowMs: NOW }),
      true,
    );

    recordEarningsFinnhubSyncedAt(db, INSIDE_WINDOW);
    assert.equal(readEarningsFinnhubSyncedAt(db), INSIDE_WINDOW);
    assert.equal(
      earningsFinnhubSyncShouldRun({ force: false, lastSuccessAt: readEarningsFinnhubSyncedAt(db), nowMs: NOW }),
      false,
    );

    recordEarningsFinnhubSyncedAt(db, PAST_WINDOW);
    assert.equal(readEarningsFinnhubSyncedAt(db), PAST_WINDOW);
    assert.equal(
      earningsFinnhubSyncShouldRun({ force: false, lastSuccessAt: readEarningsFinnhubSyncedAt(db), nowMs: NOW }),
      true,
    );
    assert.equal(
      earningsFinnhubSyncShouldRun({ force: true, lastSuccessAt: readEarningsFinnhubSyncedAt(db), nowMs: NOW }),
      true,
    );
  });
});
