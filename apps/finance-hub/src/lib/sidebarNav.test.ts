import assert from "node:assert/strict";
import test from "node:test";

import { DEFAULT_SIDEBAR_NAV_ORDER, getSidebarNavIndex, orderSidebarNavItems } from "@/app/lib/sidebarNav";

test("orderSidebarNavItems maps href order to nav items", () => {
  const ordered = orderSidebarNavItems(["/performance", "/terminal", "/positions"]);
  assert.equal(ordered.length, 3);
  assert.equal(ordered[0]!.href, "/performance");
  assert.equal(ordered[1]!.href, "/terminal");
  assert.equal(ordered[2]!.href, "/positions");
});

test("getSidebarNavIndex respects custom nav order", () => {
  const reordered = orderSidebarNavItems([
    "/performance",
    "/terminal",
    ...DEFAULT_SIDEBAR_NAV_ORDER.filter((href) => href !== "/performance" && href !== "/terminal"),
  ]);
  assert.equal(getSidebarNavIndex("/terminal", reordered), 1);
  assert.equal(getSidebarNavIndex("/performance", reordered), 0);
});
