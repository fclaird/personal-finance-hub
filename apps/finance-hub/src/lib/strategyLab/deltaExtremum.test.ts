import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { spreadShareDelta } from "@/lib/strategyLab/callSpreadOptimizer";
import { deltaExtremum, type DeltaSample } from "@/lib/strategyLab/deltaExtremum";

function grid(from: number, to: number, step: number, value: (price: number) => number): DeltaSample[] {
  const samples: DeltaSample[] = [];
  for (let price = from; price <= to + 1e-9; price += step) samples.push({ price, delta: value(price) });
  return samples;
}

describe("delta extremum", () => {
  it("refines a smooth peak between the coarse samples", () => {
    const value = (price: number) => -((price - 33) ** 2);
    const samples = grid(0, 80, 20, value);
    const found = deltaExtremum(samples, value);
    assert.ok(found);
    assert.equal(found.kind, "peak");
    assert.ok(Math.abs(found.price - 33) < 0.05, `price ${found.price}`);
    for (const sample of samples) assert.ok(found.delta + 1e-6 >= sample.delta);
  });

  it("uses a parabola when the curve is not re-evaluated", () => {
    const samples = grid(0, 80, 20, (price) => -((price - 33) ** 2));
    const found = deltaExtremum(samples);
    assert.ok(found);
    assert.equal(found.kind, "peak");
    assert.ok(Math.abs(found.price - 33) < 1, `price ${found.price}`);
  });

  it("finds a trough and ignores a smaller peak", () => {
    const samples: DeltaSample[] = [
      { price: 0, delta: 0 },
      { price: 1, delta: 5 },
      { price: 2, delta: 0 },
      { price: 3, delta: 1 },
      { price: 4, delta: -9 },
      { price: 5, delta: 1 },
      { price: 6, delta: 0 },
    ];
    const found = deltaExtremum(samples, (price) => samples.find((sample) => sample.price === Math.round(price))?.delta ?? null);
    assert.ok(found);
    assert.equal(found.kind, "trough");
    assert.ok(Math.abs(found.price - 4) < 0.6, `price ${found.price}`);
  });

  it("centers a flat expiry-style peak and skips a monotone curve", () => {
    const pulse = grid(70, 160, 5, (price) => (price >= 100 && price < 130 ? 100 : 0));
    const flat = deltaExtremum(pulse);
    assert.ok(flat);
    assert.equal(flat.kind, "peak");
    assert.equal(flat.price, 112.5);

    const rising = grid(80, 140, 5, (price) => price);
    assert.equal(deltaExtremum(rising, (price) => price), null);
    assert.equal(
      deltaExtremum(
        grid(80, 140, 5, () => 40),
        () => 40,
      ),
      null,
    );
  });

  it("places a call debit spread's optimal price inside the strikes, and moves it by expiry", () => {
    const prices = grid(60, 180, 3, () => 0).map((sample) => sample.price);
    const todaySamples = prices.map((price) => ({ price, delta: spreadShareDelta(100, 140, price, 1, 0.35) }));
    const today = deltaExtremum(todaySamples, (price) => spreadShareDelta(100, 140, price, 1, 0.35));
    assert.ok(today);
    assert.equal(today.kind, "peak");
    assert.ok(today.price > 100 && today.price < 140, `today ${today.price}`);

    const expirySamples = prices.map((price) => ({ price, delta: spreadShareDelta(100, 140, price, 0, 0.35) }));
    const expiry = deltaExtremum(expirySamples, (price) => spreadShareDelta(100, 140, price, 0, 0.35));
    assert.ok(expiry);
    assert.equal(expiry.kind, "peak");
    assert.ok(expiry.price > 100 && expiry.price < 140, `expiry ${expiry.price}`);
    assert.ok(Math.abs(expiry.price - today.price) > 0.5);
  });
});
