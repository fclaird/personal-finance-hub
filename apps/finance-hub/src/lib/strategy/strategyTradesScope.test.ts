import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { RORIE_ACCOUNT_ID } from "@/lib/flavors/accounts";
import { POSTERITY_ACCOUNT_IDS } from "@/lib/posterity";
import { strategyTradesAccountWhereSql } from "@/lib/strategy/strategyTradesScope";

describe("strategyTradesAccountWhereSql", () => {
  it("main excludes the rorie Schwab account and posterity", () => {
    const sql = strategyTradesAccountWhereSql("main");
    assert.match(sql, new RegExp(`NOT IN \\('${RORIE_ACCOUNT_ID}'\\)`));
    assert.match(sql, new RegExp(`NOT IN \\('${POSTERITY_ACCOUNT_IDS[0]}'\\)`));
  });

  it("rorie includes only the rorie Schwab account", () => {
    const sql = strategyTradesAccountWhereSql("rorie");
    assert.match(sql, new RegExp(`IN \\('${RORIE_ACCOUNT_ID}'\\)`));
    assert.doesNotMatch(sql, new RegExp(`NOT IN \\('${RORIE_ACCOUNT_ID}'\\)`));
  });
});
