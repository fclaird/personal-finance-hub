import assert from "node:assert/strict";
import test from "node:test";

import {
  collectNonIndividualSecuritySymbols,
  isIndividualSecurityHolding,
} from "./individualSecurityFilter";

test("isIndividualSecurityHolding keeps common stocks and option underlyings that are equities", () => {
  assert.equal(
    isIndividualSecurityHolding({ symbol: "AAPL", securityType: "equity", metadataJson: null }),
    true,
  );
  assert.equal(
    isIndividualSecurityHolding({
      symbol: "AAPL  250620C00200000",
      securityType: "option",
      metadataJson: null,
      underlyingSymbol: "AAPL",
      underlyingSecurityType: "equity",
    }),
    true,
  );
});

test("isIndividualSecurityHolding excludes funds, bonds, cash, and other non-equity holdings", () => {
  assert.equal(
    isIndividualSecurityHolding({ symbol: "VFFSX", securityType: "fund", metadataJson: null }),
    false,
  );
  assert.equal(
    isIndividualSecurityHolding({ symbol: "AGG", securityType: "bond", metadataJson: null }),
    false,
  );
  assert.equal(
    isIndividualSecurityHolding({ symbol: "CASH", securityType: "cash", metadataJson: null }),
    false,
  );
  assert.equal(
    isIndividualSecurityHolding({
      symbol: "OTHER",
      securityType: "other",
      metadataJson: JSON.stringify({ instrument: { assetType: "MUTUAL_FUND" } }),
    }),
    false,
  );
  assert.equal(
    isIndividualSecurityHolding({
      symbol: "SPY  250620C00500000",
      securityType: "option",
      metadataJson: null,
      underlyingSymbol: "SPY",
      underlyingSecurityType: "fund",
    }),
    false,
  );
});

test("collectNonIndividualSecuritySymbols returns unique display symbols for non-equity holdings", () => {
  const symbols = collectNonIndividualSecuritySymbols([
    { symbol: "VFFSX", securityType: "fund", metadataJson: null },
    { symbol: "VTI", securityType: "fund", metadataJson: null },
    { symbol: "VFFSX", securityType: "fund", metadataJson: null },
    { symbol: "AGG", securityType: "bond", metadataJson: null },
    { symbol: "AAPL", securityType: "equity", metadataJson: null },
  ]);
  assert.deepEqual(symbols, ["AGG", "VFFSX", "VTI"]);
});
