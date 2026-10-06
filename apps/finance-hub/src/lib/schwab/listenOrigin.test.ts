import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { requestOrigin, schwabListenMismatch } from "./listenOrigin";

describe("schwabListenMismatch", () => {
  it("warns when the page is http and Schwab will return to https", () => {
    assert.equal(
      schwabListenMismatch("http://127.0.0.1:3000", "https://127.0.0.1:3000/api/schwab/callback"),
      "This page is http://127.0.0.1:3000. Schwab will send the browser to https://127.0.0.1:3000/api/schwab/callback. Open https://127.0.0.1:3000/connections before reconnecting. If that address does not load, stop the hub and run: npm start",
    );
  });

  it("stays quiet when the page origin matches the redirect", () => {
    assert.equal(
      schwabListenMismatch("https://127.0.0.1:3000", "https://127.0.0.1:3000/api/schwab/callback"),
      null,
    );
    assert.equal(schwabListenMismatch("http://127.0.0.1:3000", "http://127.0.0.1:3000/api/schwab/callback"), null);
    assert.equal(schwabListenMismatch("http://127.0.0.1:3000", ""), null);
  });

  it("reads the request origin from host and forwarded proto", () => {
    assert.equal(requestOrigin("127.0.0.1:3000", "https"), "https://127.0.0.1:3000");
    assert.equal(requestOrigin("127.0.0.1:3000", null), "http://127.0.0.1:3000");
    assert.equal(requestOrigin("127.0.0.1:3000", "https,http"), "https://127.0.0.1:3000");
    assert.equal(requestOrigin("  ", "https"), null);
  });
});
