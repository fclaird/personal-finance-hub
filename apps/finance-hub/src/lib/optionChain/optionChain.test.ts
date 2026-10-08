import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { cacheIsFresh, formatExpiryLabel, isoDate, makeOptionChain, nearestExpiry } from "@/lib/optionChain/chain";
import { parseCboeChain } from "@/lib/optionChain/internal/cboeWire";
import { parseSchwabChain } from "@/lib/optionChain/internal/schwabWire";

const FETCHED = "2026-10-08T16:00:00.000Z";

describe("Schwab wire", () => {
  it("keeps standard 100-share contracts and drops the rest", () => {
    const draft = parseSchwabChain(
      "AVGO",
      {
        underlyingPrice: 340.12,
        isDelayed: false,
        dividendYield: 0.7,
        underlying: { quoteTime: Date.parse("2026-10-08T16:00:00.000Z") },
        callExpDateMap: {
          "2027-06-17:259": {
            "360.0": [
              {
                symbol: "AVGO  270617C00360000",
                putCall: "CALL",
                strikePrice: 360,
                bid: 28.4,
                ask: 29.2,
                volatility: 32.5,
                multiplier: 100,
                optionRoot: "AVGO",
              },
              {
                symbol: "AVGO  270617C00360000",
                putCall: "CALL",
                strikePrice: 360,
                bid: 20,
                ask: 40,
                volatility: 32.5,
                multiplier: 100,
                optionRoot: "AVGO",
              },
            ],
            "300.0": [
              {
                symbol: "AVGO1 270617C00300000",
                putCall: "CALL",
                strikePrice: 300,
                bid: 10,
                ask: 11,
                volatility: 30,
                multiplier: 100,
                optionRoot: "AVGO1",
              },
            ],
            "420.0": [
              {
                symbol: "AVGO  270617C00420000",
                putCall: "CALL",
                strikePrice: 420,
                bid: 1,
                ask: 2,
                volatility: -999,
                multiplier: 10,
                optionRoot: "AVGO",
              },
            ],
          },
        },
      },
      FETCHED,
    );
    assert.ok(draft);
    assert.ok(Math.abs((draft!.dividendYieldHint ?? 0) - 0.007) < 1e-12);
    assert.equal(draft!.delayed, false);
    const built = makeOptionChain(draft!);
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.chain.symbol, "AVGO");
    assert.equal(built.chain.tradeDate, isoDate("2026-10-08"));
    const june17 = built.chain.expiries.find((e) => e.date === isoDate("2027-06-17"));
    assert.ok(june17);
    assert.equal(june17!.strikes.length, 1);
    assert.equal(june17!.strikes[0]!.strike, 360);
    assert.equal(june17!.strikes[0]!.call?.bid, 28.4);
    assert.equal(june17!.strikes[0]!.call?.ask, 29.2);
    assert.ok(Math.abs((june17!.strikes[0]!.call?.feedIv ?? 0) - 0.325) < 1e-9);
    assert.equal(nearestExpiry(built.chain, isoDate("2027-06-18")), isoDate("2027-06-17"));
    assert.equal(formatExpiryLabel(isoDate("2027-06-17")), "Thu Jun 17, 2027");
    assert.ok(built.chain.provenance.excluded >= 2);
    assert.equal(
      built.chain.expiries.some((e) => e.date === isoDate("2027-06-18")),
      false,
    );
  });
});

describe("Cboe wire", () => {
  it("reads a delayed NOW contract through the OCC parser", () => {
    const draft = parseCboeChain(
      "NOW",
      {
        timestamp: "2026-10-08 17:18:29",
        symbol: "NOW",
        data: {
          current_price: 137.86,
          options: [
            { option: "NOW290119C00120000", bid: 53.85, ask: 59.25, iv: 0.541 },
            { option: "NOW290119C00150000", iv: 0 },
            { option: "NOW1290119C00120000", bid: 1, ask: 2, iv: 0.5 },
          ],
        },
      },
      FETCHED,
    );
    assert.ok(draft);
    assert.equal(draft!.source, "cboe");
    assert.equal(draft!.delayed, true);
    assert.equal(draft!.spot, 137.86);
    assert.equal(draft!.tradeDate, "2026-10-08");
    assert.equal(draft!.dividendYieldHint, null);
    const built = makeOptionChain(draft!);
    assert.equal(built.ok, true);
    if (!built.ok) return;
    assert.equal(built.chain.expiries.length, 1);
    const call = built.chain.expiries[0]!.strikes.find((s) => s.strike === 120)?.call;
    assert.equal(call?.mid, (53.85 + 59.25) / 2);
    assert.equal(call?.feedIv, 0.541);
    assert.equal(built.chain.expiries[0]!.strikes.some((s) => s.strike === 150), false);
  });
});

describe("cache freshness", () => {
  const t0 = Date.parse("2026-10-08T15:00:00.000Z");

  it("uses 60 seconds while the session is open and 15 minutes when it is closed", () => {
    assert.equal(cacheIsFresh(t0, t0 + 59_000, true, false), true);
    assert.equal(cacheIsFresh(t0, t0 + 60_000, true, false), false);
    assert.equal(cacheIsFresh(t0, t0 + 14 * 60_000, false, false), true);
    assert.equal(cacheIsFresh(t0, t0 + 15 * 60_000, false, false), false);
    assert.equal(cacheIsFresh(t0, t0 + 1_000, true, true), false);
  });
});
