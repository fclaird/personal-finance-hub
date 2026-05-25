import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { notAuroraExclusiveWhereSql } from "./auroraExclusive";
import { allSyncedAccountsWhereSql } from "./holdings/latestSnapshots";

describe("auroraExclusive", () => {
  it("excludes Aurora account from parent scope SQL", () => {
    assert.match(notAuroraExclusiveWhereSql("a"), /schwab_94558855/);
    assert.match(allSyncedAccountsWhereSql("a"), /schwab_94558855/);
    assert.match(allSyncedAccountsWhereSql("a"), /schwab_50138076/);
  });
});
