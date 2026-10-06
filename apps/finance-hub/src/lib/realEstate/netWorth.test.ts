import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { composeNetWorth } from "@/lib/realEstate/netWorth";

describe("composeNetWorth", () => {
  it("withholds net worth until every property has an official value", () => {
    const strip = composeNetWorth(1_000_000, [
      { officialValue: 300_000, loanBalance: 0 },
      { officialValue: null, loanBalance: 745_000 },
    ]);
    assert.equal(strip.status, "incomplete");
    assert.equal(strip.netWorth, null);
    assert.equal(strip.realEstateAssets, null);
    assert.equal(strip.mortgage, 745_000);
  });

  it("adds market value and subtracts the mortgage from investable assets", () => {
    const strip = composeNetWorth(1_000_000, [
      { officialValue: 300_000, loanBalance: 0 },
      { officialValue: 900_000, loanBalance: 745_000 },
    ]);
    assert.equal(strip.status, "ready");
    assert.equal(strip.realEstateAssets, 1_200_000);
    assert.equal(strip.mortgage, 745_000);
    assert.equal(strip.netWorth, 1_455_000);
  });
});
