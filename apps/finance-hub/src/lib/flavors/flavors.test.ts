import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { FLAVOR_IDS, parseFlavor, type FlavorId } from "@/lib/flavor";
import { accountsInFlavorWhereSql, isAccountInFlavor, PEYTON_ACCOUNT_ID, RORIE_ACCOUNT_ID } from "@/lib/flavors/accounts";
import { getFlavorConfig, isPathAllowedForFlavor, navForFlavor } from "@/lib/flavors/registry";

describe("flavor parse", () => {
  it("accepts main, rorie, and peyton", () => {
    assert.equal(parseFlavor("main"), "main");
    assert.equal(parseFlavor("rorie"), "rorie");
    assert.equal(parseFlavor("RORIE"), "rorie");
    assert.equal(parseFlavor("peyton"), "peyton");
    assert.equal(parseFlavor("PEYTON"), "peyton");
  });

  it("rejects invalid values", () => {
    assert.equal(parseFlavor(""), null);
    assert.equal(parseFlavor("aurora"), null);
    assert.equal(parseFlavor(null), null);
  });
});

describe("accountsInFlavorWhereSql", () => {
  it("main excludes rorie and peyton accounts", () => {
    const sql = accountsInFlavorWhereSql("main");
    assert.match(sql, /NOT IN \(/);
    assert.match(sql, new RegExp(RORIE_ACCOUNT_ID));
    assert.match(sql, new RegExp(PEYTON_ACCOUNT_ID));
    assert.equal(isAccountInFlavor("main", RORIE_ACCOUNT_ID), false);
    assert.equal(isAccountInFlavor("main", PEYTON_ACCOUNT_ID), false);
    assert.equal(isAccountInFlavor("main", "schwab_other"), true);
  });

  it("rorie includes only rorie account", () => {
    assert.match(accountsInFlavorWhereSql("rorie"), new RegExp(`IN \\('${RORIE_ACCOUNT_ID}'\\)`));
    assert.equal(isAccountInFlavor("rorie", RORIE_ACCOUNT_ID), true);
    assert.equal(isAccountInFlavor("rorie", PEYTON_ACCOUNT_ID), false);
    assert.equal(isAccountInFlavor("rorie", "schwab_other"), false);
  });

  it("peyton includes only peyton account", () => {
    assert.match(accountsInFlavorWhereSql("peyton"), new RegExp(`IN \\('${PEYTON_ACCOUNT_ID}'\\)`));
    assert.equal(isAccountInFlavor("peyton", PEYTON_ACCOUNT_ID), true);
    assert.equal(isAccountInFlavor("peyton", RORIE_ACCOUNT_ID), false);
    assert.equal(isAccountInFlavor("peyton", "schwab_other"), false);
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

  it("names realized gain and loss in every flavor and keeps the reports route", () => {
    for (const id of ["main", "rorie", "peyton"] as const) {
      const item = navForFlavor(id).find((entry) => entry.href === "/reports");
      assert.equal(item?.href, "/reports");
      assert.equal(item?.label, "Realized gain/loss");
    }
  });

  it("peyton nav matches rorie", () => {
    assert.deepEqual(navForFlavor("peyton"), navForFlavor("rorie"));
    assert.equal(getFlavorConfig("peyton").label, "Peyton");
    assert.equal(getFlavorConfig("peyton").features.posterity, false);
    assert.equal(getFlavorConfig("peyton").features.strategies, false);
    assert.notEqual(getFlavorConfig("peyton").accent.badgeClass, getFlavorConfig("rorie").accent.badgeClass);
    assert.notEqual(getFlavorConfig("peyton").accent.badgeClass, getFlavorConfig("main").accent.badgeClass);
    assert.match(getFlavorConfig("main").accent.badgeClass, /bg-zinc-100/);
  });

  it("blocks disallowed routes per flavor", () => {
    assert.equal(isPathAllowedForFlavor("/earnings", "rorie"), false);
    assert.equal(isPathAllowedForFlavor("/earnings", "peyton"), false);
    assert.equal(isPathAllowedForFlavor("/earnings", "main"), true);
    assert.equal(isPathAllowedForFlavor("/strategies/all", "rorie"), false);
    assert.equal(isPathAllowedForFlavor("/strategies/all", "peyton"), false);
    assert.equal(isPathAllowedForFlavor("/posterity", "peyton"), false);
    assert.equal(isPathAllowedForFlavor("/posterity", "main"), true);
    assert.equal(isPathAllowedForFlavor("/strategies/situations", "main"), true);
    assert.equal(isPathAllowedForFlavor("/strategies/realized", "main"), true);
    assert.equal(navForFlavor("main").some((n) => n.href === "/strategies/situations"), true);
    assert.equal(isPathAllowedForFlavor("/terminal/symbol/SPY", "rorie"), true);
    assert.equal(isPathAllowedForFlavor("/terminal/symbol/SPY", "peyton"), true);
    assert.equal(isPathAllowedForFlavor("/connections", "main"), true);
  });
});

describe("flavor ids", () => {
  it("registry covers all flavor ids", () => {
    const ids: FlavorId[] = [...FLAVOR_IDS];
    for (const id of ids) {
      assert.ok(navForFlavor(id).length > 0);
      assert.equal(getFlavorConfig(id).id, id);
    }
  });
});
