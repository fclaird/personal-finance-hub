import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isoDate, makeOptionChain, type DraftContract } from "@/lib/optionChain/chain";
import { expectedMoveFromChain } from "@/lib/events/expectedMove";

function contract(expiry: string, right: "C" | "P", strike: number, bid: number, ask: number, feedIv: number | null = null): DraftContract {
  return { expiry, right, strike, bid, ask, feedIv, multiplier: 100, root: null };
}

function chain(contracts: DraftContract[], spot = 100, tradeDate = "2026-10-11") {
  const built = makeOptionChain({
    symbol: "NOW",
    spot,
    tradeDate,
    quoteTime: null,
    source: "schwab",
    delayed: false,
    dividendYieldHint: null,
    contracts,
    fetchedAt: "2026-10-11T16:00:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
  });
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

describe("expected move from the ATM straddle", () => {
  it("uses the nearest expiry and the strike closest to spot", () => {
    const move = expectedMoveFromChain(
      chain([
        contract("2026-10-09", "C", 100, 1, 1.2),
        contract("2026-10-09", "P", 100, 1, 1.2),
        contract("2026-10-16", "C", 95, 6, 6.4),
        contract("2026-10-16", "P", 95, 1, 1.2),
        contract("2026-10-16", "C", 100, 2.8, 3.2, 0.4),
        contract("2026-10-16", "P", 100, 1.8, 2.2, 0.36),
        contract("2026-11-20", "C", 100, 8, 8.4),
        contract("2026-11-20", "P", 100, 7, 7.4),
      ]),
    );
    assert.ok(move);
    assert.equal(move.expiry, isoDate("2026-10-16"));
    assert.equal(move.strike, 100);
    assert.equal(move.callMid, 3);
    assert.equal(move.putMid, 2);
    assert.equal(move.moveDollars, 5);
    assert.equal(move.movePct, 0.05);
    assert.equal(move.atmIv, 0.38);
    assert.equal(move.source, "schwab");
  });

  it("skips an expiry that has no two-sided straddle", () => {
    const move = expectedMoveFromChain(
      chain([
        contract("2026-10-16", "C", 100, 3, 3.2),
        contract("2026-11-20", "C", 100, 4, 4.4),
        contract("2026-11-20", "P", 100, 3, 3.4),
      ]),
    );
    assert.equal(move?.expiry, isoDate("2026-11-20"));
    assert.equal(move?.moveDollars, 7.4);
  });

  it("returns null when no straddle is listed", () => {
    assert.equal(expectedMoveFromChain(chain([contract("2026-10-16", "C", 100, 3, 3.2)])), null);
  });
});
