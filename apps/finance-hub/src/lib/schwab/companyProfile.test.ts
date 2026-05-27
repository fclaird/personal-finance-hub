import assert from "node:assert/strict";
import test from "node:test";

import { parseSchwabInstrumentFundamental } from "@/lib/schwab/instrumentFundamental";

test("parseSchwabInstrumentFundamental reads nested quote fundamental layer", () => {
  const parsed = parseSchwabInstrumentFundamental(
    {
      RKLB: {
        quote: { lastPrice: 143.56, "52WeekHigh": 146, "52WeekLow": 23.92 },
        fundamental: {
          companyName: "Rocket Lab USA, Inc.",
          sector: "Industrials",
          industry: "Aerospace & Defense",
          marketCap: 7_200_000_000,
          beta: 2.14,
          sharesOutstanding: 50_000_000,
        },
      },
    },
    "RKLB",
  );
  assert.equal(parsed.companyName, "Rocket Lab USA, Inc.");
  assert.equal(parsed.marketCap, 7_200_000_000);
  assert.equal(parsed.beta, 2.14);
  assert.equal(parsed.sector, "Industrials");
});
