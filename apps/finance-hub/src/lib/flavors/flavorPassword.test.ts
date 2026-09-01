import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import { expectedFlavorPassword, verifyFlavorPassword } from "@/lib/flavors/flavorPassword";

const env = process.env;

afterEach(() => {
  process.env = { ...env };
});

describe("flavorPassword", () => {
  it("uses flavor-specific env when set", () => {
    process.env.FINANCE_HUB_FLAVOR_PASSWORD_MAIN = "secret-main";
    process.env.FINANCE_HUB_PASSPHRASE = "fallback";
    assert.equal(expectedFlavorPassword("main"), "secret-main");
    assert.equal(verifyFlavorPassword("main", "secret-main"), true);
    assert.equal(verifyFlavorPassword("main", "wrong"), false);
  });

  it("does not fall back to FINANCE_HUB_PASSPHRASE", () => {
    delete process.env.FINANCE_HUB_FLAVOR_PASSWORD_RORIE;
    process.env.FINANCE_HUB_PASSPHRASE = "shared";
    assert.equal(expectedFlavorPassword("rorie"), null);
    assert.equal(verifyFlavorPassword("rorie", "shared"), true);
  });

  it("allows any password when none configured", () => {
    delete process.env.FINANCE_HUB_FLAVOR_PASSWORD_MAIN;
    delete process.env.FINANCE_HUB_PASSPHRASE;
    assert.equal(expectedFlavorPassword("main"), null);
    assert.equal(verifyFlavorPassword("main", ""), true);
    assert.equal(verifyFlavorPassword("main", "anything"), true);
  });
});
