import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { textMatchesSymbol } from "./matchSymbols";

describe("textMatchesSymbol", () => {
  it("matches dollar ticker", () => {
    assert.equal(textMatchesSymbol("Breaking: $PLTR contract", "PLTR", null), true);
  });

  it("matches word boundary ticker", () => {
    assert.equal(textMatchesSymbol("TSLA shares rally", "TSLA", null), true);
  });

  it("skips short tickers without dollar", () => {
    assert.equal(textMatchesSymbol("ON stock rises", "ON", null), false);
  });

  it("matches company name tokens", () => {
    assert.equal(textMatchesSymbol("Palantir wins deal", "PLTR", "Palantir Technologies"), true);
  });
});
