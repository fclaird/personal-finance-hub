import assert from "node:assert/strict";
import test from "node:test";

import { holdingAnnualDivUsd, holdingYieldPct } from "./holdingYieldPct";

test("holdingYieldPct uses divYield when present", () => {
  assert.equal(holdingYieldPct({ divYield: 0.042, annualDivEst: null, last: 50, shares: 10, marketValue: 500 }), 4.2);
});

test("holdingYieldPct derives from annual div and price", () => {
  assert.equal(
    holdingYieldPct({ divYield: null, annualDivEst: 2, last: 50, shares: 10, marketValue: 500 }),
    4,
  );
});

test("holdingAnnualDivUsd uses annual div per share times shares", () => {
  assert.equal(
    holdingAnnualDivUsd({ divYield: null, annualDivEst: 2, last: 50, shares: 10, marketValue: 500 }),
    20,
  );
});

test("holdingAnnualDivUsd derives from div yield when annual div missing", () => {
  assert.equal(
    holdingAnnualDivUsd({ divYield: 0.04, annualDivEst: null, last: 50, shares: 10, marketValue: 500 }),
    20,
  );
});
