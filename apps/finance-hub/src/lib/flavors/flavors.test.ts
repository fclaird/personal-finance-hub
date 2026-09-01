import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { FlavorId } from "@/lib/flavor";
import { accountsInFlavorWhereSql, isAccountInFlavor, RORIE_ACCOUNT_ID } from "@/lib/flavors/accounts";
import { isPathAllowedForFlavor, navForFlavor } from "@/lib/flavors/registry";
import { parseFlavor } from "@/lib/flavor";

describe("flavor parse", () => {
  it("accepts main and rorie", () => {
    assert.equal(parseFlavor("main"), "main");
    assert.equal(parseFlavor("rorie"), "rorie");
    assert.equal(parseFlavor("RORIE"), "rorie");
  });

  it("rejects invalid values", () => {
    assert.equal(parseFlavor(""), null);
    assert.equal(parseFlavor("aurora"), null);
    assert.equal(parseFlavor(null), null);
  });
});

describe("accountsInFlavorWhereSql", () => {
  it("main excludes rorie account", () => {
    assert.match(accountsInFlavorWhereSql("main"), new RegExp(`NOT IN \\('${RORIE_ACCOUNT_ID}'\\)`));
    assert.equal(isAccountInFlavor("main", RORIE_ACCOUNT_ID), false);
    assert.equal(isAccountInFlavor("main", "schwab_other"), true);
  });

  it("rorie includes only rorie account", () => {
    assert.match(accountsInFlavorWhereSql("rorie"), new RegExp(`IN \\('${RORIE_ACCOUNT_ID}'\\)`));
    assert.equal(isAccountInFlavor("rorie", RORIE_ACCOUNT_ID), true);
    assert.equal(isAccountInFlavor("rorie", "schwab_other"), false);
  });
});

describe("nav and route guards", () => {
  it("rorie nav matches Aurora reduced tabs", () => {
    const hrefs = navForFlavor("rorie").map((n) => n.href);
    assert.deepEqual(hrefs, [
      "/terminal",
      "/positions",
      "/allocation",
      "/diversification",
      "/performance",
      "/reports",
      "/dividends",
      "/rebalancing",
      "/alerts",
      "/connections",
    ]);
  });

  it("blocks disallowed routes per flavor", () => {
    assert.equal(isPathAllowedForFlavor("/earnings", "rorie"), false);
    assert.equal(isPathAllowedForFlavor("/earnings", "main"), true);
    assert.equal(isPathAllowedForFlavor("/strategies/all", "rorie"), false);
    assert.equal(isPathAllowedForFlavor("/terminal/symbol/SPY", "rorie"), true);
    assert.equal(isPathAllowedForFlavor("/connections", "main"), true);
  });
});

describe("flavor ids", () => {
  it("registry covers all flavor ids", () => {
    const ids: FlavorId[] = ["main", "rorie"];
    for (const id of ids) {
      assert.ok(navForFlavor(id).length > 0);
    }
  });
});
