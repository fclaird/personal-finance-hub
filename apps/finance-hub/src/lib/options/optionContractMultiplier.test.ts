import assert from "node:assert/strict";
import test from "node:test";

import {
  optionMarketValueFromMark,
  optionMarkFromMarketValue,
  resolveOptionContractMultiplier,
} from "@/lib/options/optionContractMultiplier";

test("multiplier 100 still yields mark * 100 * signed quantity", () => {
  const multiplier = resolveOptionContractMultiplier(JSON.stringify({ instrument: { optionMultiplier: 100 } }));
  assert.equal(multiplier, 100);
  assert.equal(optionMarketValueFromMark(2.5, 4, multiplier), 2.5 * 100 * 4);
  assert.equal(optionMarketValueFromMark(2.5, -4, multiplier), 2.5 * 100 * -4);
});

test("multiplier other than 100 uses that multiplier", () => {
  const fromPosition = resolveOptionContractMultiplier(JSON.stringify({ multiplier: 10 }));
  const fromInstrument = resolveOptionContractMultiplier(
    JSON.stringify({ instrument: { optionMultiplier: 10 } }),
  );
  assert.equal(fromPosition, 10);
  assert.equal(fromInstrument, 10);
  assert.equal(optionMarketValueFromMark(3.2, 2, fromInstrument), 3.2 * 10 * 2);
  assert.equal(optionMarketValueFromMark(3.2, -2, fromPosition), 3.2 * 10 * -2);
  assert.equal(optionMarkFromMarketValue(3.2 * 10 * -2, -2, 10), 3.2);
});

test("missing multiplier still uses 100", () => {
  assert.equal(resolveOptionContractMultiplier(null), 100);
  assert.equal(resolveOptionContractMultiplier(undefined), 100);
  assert.equal(resolveOptionContractMultiplier(""), 100);
  assert.equal(resolveOptionContractMultiplier("{}"), 100);
  assert.equal(resolveOptionContractMultiplier("not-json"), 100);
  assert.equal(resolveOptionContractMultiplier(JSON.stringify({ multiplier: 0 })), 100);
  assert.equal(resolveOptionContractMultiplier(JSON.stringify({ multiplier: -5 })), 100);
  assert.equal(resolveOptionContractMultiplier(JSON.stringify({ instrument: { optionMultiplier: "10" } })), 100);
  assert.equal(optionMarketValueFromMark(1.5, 2, resolveOptionContractMultiplier(null)), 1.5 * 100 * 2);
  assert.equal(optionMarketValueFromMark(1.5, -3, resolveOptionContractMultiplier("{}")), 1.5 * 100 * -3);
});
