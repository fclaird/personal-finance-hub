import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  assertSchwabTraderCallAllowed,
  isBrokerOrderWriteAuthorized,
  traderPathLooksLikeOrder,
} from "@/lib/schwab/tradeWall";

describe("Schwab trade wall", () => {
  afterEach(() => {
    delete process.env.FINANCE_HUB_ALLOW_BROKER_ORDERS;
  });

  it("allows ordinary GET reads and blocks order paths by default", () => {
    assert.equal(isBrokerOrderWriteAuthorized(), false);
    assert.equal(traderPathLooksLikeOrder("accounts/accountNumbers"), false);
    assert.equal(traderPathLooksLikeOrder("accounts/abc/orders"), true);
    assert.doesNotThrow(() => assertSchwabTraderCallAllowed("accounts?fields=positions"));
    assert.doesNotThrow(() => assertSchwabTraderCallAllowed("accounts/h/transactions?types=TRADE"));
    assert.throws(() => assertSchwabTraderCallAllowed("accounts/h/orders"), /Chinese wall/);
    assert.throws(() => assertSchwabTraderCallAllowed("accounts/h/previewOrder", "POST"), /Chinese wall/);
    assert.throws(() => assertSchwabTraderCallAllowed("accounts", "POST"), /Chinese wall/);
  });

  it("still requires the explicit flag even for a future authorized path", () => {
    process.env.FINANCE_HUB_ALLOW_BROKER_ORDERS = "1";
    assert.equal(isBrokerOrderWriteAuthorized(), true);
    assert.doesNotThrow(() => assertSchwabTraderCallAllowed("accounts/h/orders", "POST"));
  });
});
