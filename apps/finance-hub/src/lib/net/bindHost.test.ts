import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isLoopbackBindHost, remoteBindBlockedReason, resolveBindHost, resolveListenPort } from "@/lib/net/bindHost";

describe("bindHost", () => {
  it("defaults to loopback and treats localhost aliases as safe", () => {
    assert.equal(resolveBindHost({}), "127.0.0.1");
    assert.equal(isLoopbackBindHost("127.0.0.1"), true);
    assert.equal(isLoopbackBindHost("localhost"), true);
    assert.equal(isLoopbackBindHost("0.0.0.0"), false);
    assert.equal(isLoopbackBindHost("100.64.1.2"), false);
  });

  it("blocks remote bind without an API key and allows it with one", () => {
    assert.match(remoteBindBlockedReason("0.0.0.0", "") ?? "", /FINANCE_HUB_API_KEY/);
    assert.equal(remoteBindBlockedReason("0.0.0.0", "long-key"), null);
    assert.equal(remoteBindBlockedReason("127.0.0.1", ""), null);
    assert.equal(resolveListenPort({ PORT: "3049" }), 3049);
  });
});
