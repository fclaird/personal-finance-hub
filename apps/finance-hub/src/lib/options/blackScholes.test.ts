import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bsmGreeks, bsmPrice, impliedVol } from "@/lib/options/blackScholes";

describe("blackScholes", () => {
  it("puts and calls obey parity with a dividend yield", () => {
    const spot = 100;
    const strike = 100;
    const years = 1;
    const rate = 0.04;
    const dividendYield = 0.02;
    const vol = 0.25;
    const call = bsmPrice({ right: "C", spot, strike, years, rate, dividendYield, vol });
    const put = bsmPrice({ right: "P", spot, strike, years, rate, dividendYield, vol });
    const parity = spot * Math.exp(-dividendYield * years) - strike * Math.exp(-rate * years);
    assert.ok(Math.abs(call - put - parity) < 1e-8);
  });

  it("pins NOW Jan 2029 package greeks at the note's IVs", () => {
    const spot = 136.58;
    const years = 834 / 365;
    const rate = 0.04;
    const q = 0;
    const leg = (strike: number, vol: number, ratio: number) => {
      const g = bsmGreeks({ right: "C", spot, strike, years, rate, dividendYield: q, vol });
      return {
        delta: g.delta * ratio * 100,
        gamma: g.gamma * ratio * 100,
        theta: (g.thetaPerYear / 365) * ratio * 100,
        vega: g.vega * 0.01 * ratio * 100,
      };
    };
    const sum = (rows: ReturnType<typeof leg>[]) =>
      rows.reduce(
        (a, r) => ({
          delta: a.delta + r.delta,
          gamma: a.gamma + r.gamma,
          theta: a.theta + r.theta,
          vega: a.vega + r.vega,
        }),
        { delta: 0, gamma: 0, theta: 0, vega: 0 },
      );
    const a = sum([leg(150, 0.552, 1), leg(210, 0.538, -1)]);
    const b = sum([leg(160, 0.547, 1), leg(210, 0.538, -1)]);
    const c = sum([leg(120, 0.581, 2), leg(210, 0.538, -1)]);
    assert.ok(Math.abs(a.delta - 16.5) < 0.1);
    assert.ok(Math.abs(a.gamma - -0.038) < 0.002);
    assert.ok(Math.abs(a.theta - 0.08) < 0.02);
    assert.ok(Math.abs(a.vega - -6.77) < 0.05);
    assert.ok(Math.abs(b.delta - 13.4) < 0.1);
    assert.ok(Math.abs(b.theta - 0.03) < 0.02);
    assert.ok(Math.abs(b.vega - -4.43) < 0.05);
    assert.ok(Math.abs(c.delta - 101.4) < 0.1);
    assert.ok(Math.abs(c.gamma - 0.164) < 0.002);
    assert.ok(Math.abs(c.theta - -2.46) < 0.02);
    assert.ok(Math.abs(c.vega - 47.41) < 0.05);
  });

  it("round-trips implied vol", () => {
    const price = bsmPrice({
      right: "C",
      spot: 136.58,
      strike: 150,
      years: 834 / 365,
      rate: 0.04,
      dividendYield: 0,
      vol: 0.552,
    });
    const solved = impliedVol({
      right: "C",
      spot: 136.58,
      strike: 150,
      years: 834 / 365,
      rate: 0.04,
      dividendYield: 0,
      price,
    });
    assert.equal(solved.ok, true);
    if (solved.ok) assert.ok(Math.abs(solved.vol - 0.552) < 1e-4);
  });
});
