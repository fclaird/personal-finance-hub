import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { crrPrice, europeanClosedForm } from "@/lib/fortress/american";

const base = { spot: 100, strike: 100, years: 1, rate: 0.05, dividendYield: 0, vol: 0.2 };

describe("american tree", () => {
  it("matches the European closed form within a disclosed tolerance and tightens with more steps", () => {
    const closed = europeanClosedForm({ ...base, right: "P" });
    const coarse = crrPrice({ ...base, right: "P", style: "european", steps: 50 });
    const fine = crrPrice({ ...base, right: "P", style: "european", steps: 200 });
    assert.equal(coarse.ok && fine.ok, true);
    if (!coarse.ok || !fine.ok) return;
    const coarseError = Math.abs(coarse.value.price - closed.price);
    const fineError = Math.abs(fine.value.price - closed.price);
    assert.ok(fineError < 0.05, `fine error ${fineError}`);
    assert.ok(fineError < coarseError, `fine ${fineError} coarse ${coarseError}`);
  });

  it("does not exercise an American call early when the dividend yield is zero", () => {
    const european = crrPrice({ ...base, right: "C", style: "european", steps: 200 });
    const american = crrPrice({ ...base, right: "C", style: "american", steps: 200 });
    assert.equal(european.ok && american.ok, true);
    if (!european.ok || !american.ok) return;
    assert.ok(Math.abs(american.value.price - european.value.price) < 0.05);
  });

  it("prices an American put above the European closed form when early exercise has value", () => {
    const input = { spot: 100, strike: 100, years: 1, rate: 0.08, dividendYield: 0, vol: 0.2, right: "P" as const };
    const closed = europeanClosedForm(input);
    const american = crrPrice({ ...input, style: "american", steps: 400 });
    assert.equal(american.ok, true);
    if (!american.ok) return;
    assert.ok(american.value.price > closed.price + 0.05, `${american.value.price} vs ${closed.price}`);
  });

  it("keeps tree delta near the closed-form delta for a European put", () => {
    const closed = europeanClosedForm({ ...base, right: "P" });
    const tree = crrPrice({ ...base, right: "P", style: "european", steps: 200 });
    assert.equal(tree.ok, true);
    if (!tree.ok) return;
    assert.ok(Math.abs(tree.value.delta - closed.delta) < 0.03, `${tree.value.delta} vs ${closed.delta}`);
    assert.ok(Math.abs(tree.value.vegaPerPoint - closed.vega * 0.01) < 0.05);
  });

  it("tracks a European put when the dividend yield is explicit, and lets an American call exceed it when yield is high", () => {
    const yielded = { spot: 100, strike: 100, years: 1, rate: 0.05, dividendYield: 0.03, vol: 0.2, right: "P" as const };
    const closed = europeanClosedForm(yielded);
    const tree = crrPrice({ ...yielded, style: "european", steps: 200 });
    assert.equal(tree.ok, true);
    if (!tree.ok) return;
    assert.ok(Math.abs(tree.value.price - closed.price) < 0.08, `${tree.value.price} vs ${closed.price}`);
    const call = { spot: 100, strike: 100, years: 1, rate: 0.05, dividendYield: 0.08, vol: 0.25, right: "C" as const };
    const european = crrPrice({ ...call, style: "european", steps: 200 });
    const american = crrPrice({ ...call, style: "american", steps: 200 });
    assert.equal(european.ok && american.ok, true);
    if (!european.ok || !american.ok) return;
    assert.ok(american.value.price > european.value.price + 0.02);
  });

  it("pays intrinsic at expiry", () => {
    const tree = crrPrice({ ...base, right: "P", style: "american", years: 0, steps: 10 });
    assert.equal(tree.ok, true);
    if (!tree.ok) return;
    assert.equal(tree.value.price, 0);
    const itm = crrPrice({ ...base, spot: 80, right: "P", style: "american", years: 0, steps: 10 });
    assert.equal(itm.ok && itm.value.price, 20);
  });
});
