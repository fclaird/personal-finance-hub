import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isoDate, makeOptionChain, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { resolveTemplate, type TemplateRequest } from "@/lib/strategyLab/internal/templates";
import { nearestDeltaStrike, strikeDeltas } from "@/lib/strategyLab/strikeDelta";

const NEAR = "2026-11-20";
const FAR = "2027-01-15";
const ASSUMPTIONS = { rate: 0.04, dividendYield: 0 };

function chainOf(): OptionChain {
  const strikes = [80, 90, 100, 110, 120];
  const contracts: DraftContract[] = [];
  for (const expiry of [NEAR, FAR]) {
    for (const strike of strikes) {
      const distance = Math.abs(strike - 100) / 100;
      const mid = Math.max(0.4, 8 - distance * 20);
      for (const right of ["C", "P"] as const) {
        contracts.push({
          expiry,
          right,
          strike,
          bid: mid - 0.1,
          ask: mid + 0.1,
          feedIv: null,
          multiplier: 100,
          root: null,
        });
      }
    }
  }
  const built = makeOptionChain({
    symbol: "NOW",
    spot: 100,
    tradeDate: "2026-10-08",
    quoteTime: null,
    source: "cboe",
    delayed: true,
    dividendYieldHint: 0,
    contracts,
    fetchedAt: "2026-10-08T16:00:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
  });
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

function legsOf(request: TemplateRequest, expiry = FAR) {
  const resolved = resolveTemplate(request, chainOf(), isoDate(expiry), ASSUMPTIONS);
  assert.ok(!("error" in resolved), "error" in resolved ? resolved.error : "");
  if ("error" in resolved) throw new Error(resolved.error);
  return resolved.legs;
}

describe("template library", () => {
  const k = (strike: number) => ({ by: "strike" as const, strike });

  it("prefills each catalog shape", () => {
    assert.deepEqual(legsOf({ template: "longCall", strike: k(100) }).map((leg) => [leg.right, leg.ratio, leg.stock]), [["C", 1, false]]);
    assert.deepEqual(legsOf({ template: "longPut", strike: k(90) }).map((leg) => [leg.right, leg.strike, leg.ratio]), [["P", 90, 1]]);
    assert.deepEqual(
      legsOf({ template: "callDebit", long: k(90), short: k(110) }).map((leg) => [leg.right, leg.strike, leg.ratio]),
      [
        ["C", 90, 1],
        ["C", 110, -1],
      ],
    );
    assert.deepEqual(
      legsOf({ template: "callDebitSpread", long: k(90), short: k(110) }).map((leg) => leg.ratio),
      [1, -1],
    );
    assert.deepEqual(
      legsOf({ template: "putDebit", long: k(110), short: k(90) }).map((leg) => [leg.strike, leg.ratio]),
      [
        [110, 1],
        [90, -1],
      ],
    );
    assert.deepEqual(
      legsOf({ template: "callCredit", long: k(110), short: k(90) }).map((leg) => [leg.strike, leg.ratio]),
      [
        [90, -1],
        [110, 1],
      ],
    );
    assert.deepEqual(
      legsOf({ template: "putCredit", long: k(90), short: k(110) }).map((leg) => [leg.strike, leg.ratio]),
      [
        [90, 1],
        [110, -1],
      ],
    );
    const straddle = legsOf({ template: "longStraddle", strike: k(100) });
    assert.deepEqual(straddle.map((leg) => [leg.right, leg.strike, leg.ratio]), [
      ["C", 100, 1],
      ["P", 100, 1],
    ]);
    assert.deepEqual(legsOf({ template: "shortStraddle", strike: k(100) }).map((leg) => leg.ratio), [-1, -1]);
    assert.deepEqual(
      legsOf({ template: "longStrangle", put: k(90), call: k(110) }).map((leg) => [leg.right, leg.ratio]),
      [
        ["P", 1],
        ["C", 1],
      ],
    );
    const condor = legsOf({
      template: "ironCondor",
      putLong: k(80),
      putShort: k(90),
      callShort: k(110),
      callLong: k(120),
    });
    assert.deepEqual(condor.map((leg) => [leg.right, leg.strike, leg.ratio]), [
      ["P", 80, 1],
      ["P", 90, -1],
      ["C", 110, -1],
      ["C", 120, 1],
    ]);
    const fly = legsOf({ template: "ironButterfly", low: k(90), body: k(100), high: k(110) });
    assert.deepEqual(fly.map((leg) => [leg.right, leg.strike, leg.ratio]), [
      ["P", 90, 1],
      ["P", 100, -1],
      ["C", 100, -1],
      ["C", 110, 1],
    ]);
    assert.deepEqual(
      legsOf({ template: "callButterfly", low: k(90), body: k(100), high: k(110) }).map((leg) => [leg.strike, leg.ratio]),
      [
        [90, 1],
        [100, -2],
        [110, 1],
      ],
    );
    assert.equal(legsOf({ template: "putButterfly", low: k(90), body: k(100), high: k(110) })[0]?.right, "P");
    assert.deepEqual(legsOf({ template: "syntheticShort", strike: k(100) }).map((leg) => [leg.right, leg.ratio]), [
      ["C", -1],
      ["P", 1],
    ]);
    assert.deepEqual(
      legsOf({ template: "riskReversal", put: k(90), call: k(110) }).map((leg) => [leg.right, leg.ratio]),
      [
        ["P", -1],
        ["C", 1],
      ],
    );
    const collar = legsOf({ template: "collar", put: k(90), call: k(110) });
    assert.equal(collar[0]?.stock, true);
    assert.equal(collar[0]?.ratio, 100);
    assert.deepEqual(collar.slice(1).map((leg) => [leg.right, leg.ratio]), [
      ["P", 1],
      ["C", -1],
    ]);
    const covered = legsOf({ template: "coveredCall", call: k(110) });
    assert.equal(covered[0]?.stock, true);
    assert.equal(covered[1]?.right, "C");
    assert.equal(covered[1]?.ratio, -1);
    const naked = legsOf({ template: "custom", legs: [{ right: "C", strike: 110, ratio: -1 }] });
    assert.equal(naked.some((leg) => leg.stock), false);
    assert.equal(naked[0]?.ratio, -1);
    assert.deepEqual(legsOf({ template: "cashSecuredPut", strike: k(90) }).map((leg) => [leg.right, leg.ratio, leg.stock]), [["P", -1, false]]);
    const calendar = legsOf({ template: "calendar", right: "C", front: isoDate(NEAR), strike: k(100) });
    assert.deepEqual(calendar.map((leg) => [leg.ratio, leg.expiry, leg.strike]), [
      [-1, isoDate(NEAR), 100],
      [1, null, 100],
    ]);
    const diagonal = legsOf({
      template: "diagonal",
      right: "C",
      front: isoDate(NEAR),
      frontStrike: k(110),
      backStrike: k(100),
    });
    assert.equal(diagonal[0]?.expiry, isoDate(NEAR));
    assert.equal(diagonal[0]?.strike, 110);
    assert.equal(diagonal[1]?.strike, 100);
    assert.equal(diagonal[1]?.expiry, null);
    const zebra = legsOf({ template: "zebra", long: k(90), short: k(110) });
    assert.deepEqual(zebra.map((leg) => [leg.right, leg.strike, leg.ratio, leg.expiry]), [
      ["C", 90, 2, null],
      ["C", 110, -1, null],
    ]);
  });

  it("rejects an uneven butterfly and a naked name on a short call", () => {
    const uneven = resolveTemplate(
      { template: "callButterfly", low: k(80), body: k(100), high: k(110) },
      chainOf(),
      isoDate(FAR),
      ASSUMPTIONS,
    );
    assert.ok("error" in uneven);
    const putDiagonal = legsOf({
      template: "diagonal",
      right: "P",
      front: isoDate(NEAR),
      frontStrike: k(90),
      backStrike: k(100),
    });
    assert.ok((putDiagonal[0]?.strike ?? 0) < (putDiagonal[1]?.strike ?? 0));
  });

  it("defaults a short strangle near 15 delta", () => {
    const chain = chainOf();
    const put = nearestDeltaStrike(strikeDeltas(chain, isoDate(FAR), "P", ASSUMPTIONS), 0.15, "lower");
    const call = nearestDeltaStrike(strikeDeltas(chain, isoDate(FAR), "C", ASSUMPTIONS), 0.15, "higher");
    const resolved = resolveTemplate(
      { template: "shortStrangle", put: { by: "delta", delta: 0.15 }, call: { by: "delta", delta: 0.15 } },
      chain,
      isoDate(FAR),
      ASSUMPTIONS,
    );
    assert.ok(!("error" in resolved));
    if ("error" in resolved) return;
    assert.equal(resolved.legs[0]?.strike, put);
    assert.equal(resolved.legs[1]?.strike, call);
    assert.ok((put ?? 0) < (call ?? 0));
  });
});
