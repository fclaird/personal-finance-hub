import assert from "node:assert/strict";
import test from "node:test";

function divergencePct(a: number, b: number): number {
  const ref = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return (Math.abs(a - b) / ref) * 100;
}

function pricesAgree(a: number, b: number, tolerancePct = 0.2): boolean {
  return divergencePct(a, b) <= tolerancePct;
}

test("pricesAgree treats small ES futures drift as reconciled", () => {
  assert.equal(pricesAgree(7548.25, 7548.25), true);
  assert.equal(pricesAgree(7548.25, 7549.0), true);
  assert.equal(pricesAgree(7548.25, 7580), false);
});

test("divergencePct scales relative to price level", () => {
  assert.ok(divergencePct(7847.71, 7847.71) < 0.001);
  assert.ok(divergencePct(7847.71, 7860) > 0.1);
});
