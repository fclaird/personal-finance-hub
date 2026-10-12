import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { calendarDaysBetween, isoDate, makeOptionChain, type ChainDraft, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { expiryPnl } from "@/lib/strategyLab/internal/pricing";
import { packageShareDelta } from "@/lib/strategyLab/internal/pricing";
import { createLab, editLab, evaluateLab } from "@/lib/strategyLab/lab";
import { syntheticFinancingGap } from "@/lib/strategyLab/legs";
import { MODEL_RATE } from "@/lib/strategyLab/modelAssumptions";

const EXPIRY = "2027-01-15";
const TRADE = "2026-10-08";

function chainOf(contracts: DraftContract[]): OptionChain {
  const built = makeOptionChain({
    symbol: "NOW",
    spot: 140,
    tradeDate: TRADE,
    quoteTime: null,
    source: "cboe",
    delayed: true,
    dividendYieldHint: 0,
    contracts,
    fetchedAt: "2026-10-08T16:00:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
  } satisfies ChainDraft);
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

function contract(right: "C" | "P", strike: number, bid: number, ask: number): DraftContract {
  return { expiry: EXPIRY, right, strike, bid, ask, feedIv: null, multiplier: 100, root: null };
}

describe("synthetic parity", () => {
  const chain = chainOf([contract("C", 140, 19, 21), contract("P", 140, 14, 16)]);
  const lab = editLab(
    createLab(chain),
    {
      kind: "addStructure",
      label: "Synthetic",
      expiry: isoDate(EXPIRY),
      request: { template: "syntheticLong", strike: { by: "strike", strike: 140 } },
    },
    chain,
  );
  const ev = evaluateLab(lab, chain);
  const row = ev.structures[0];

  it("is a long call and a short put on one listed strike", () => {
    assert.equal(lab.structures[0]?.resolveError, null);
    assert.deepEqual(
      lab.structures[0]?.legs.map((leg) => [leg.instrument, leg.side, leg.quantity, leg.strike, leg.expiry]),
      [
        ["call", "long", 1, 140, isoDate(EXPIRY)],
        ["put", "short", 1, 140, isoDate(EXPIRY)],
      ],
    );
  });

  it("tracks 100 shares minus financing, with delta about 1", () => {
    assert.ok(row && row.status === "priced");
    if (!row || row.status !== "priced") return;
    const years = calendarDaysBetween(isoDate(TRADE), isoDate(EXPIRY)) / 365;
    const assumptions = { rate: MODEL_RATE, dividendYield: 0, ivSource: "mid" as const };
    for (const spot of [112, 140, 168]) {
      const delta = packageShareDelta(row.legs, assumptions, spot, years);
      assert.ok(delta != null && Math.abs(delta - 100) < 0.5, `delta at ${spot}`);
    }
    assert.equal(row.risk.slopeAbove, 100);
    const gap = syntheticFinancingGap(140, years, 1);
    for (const spot of [100, 140, 200]) {
      const synthetic = expiryPnl(row.legs, row.debit, spot);
      const shares = (spot - chain.spot) * 100;
      assert.ok(Math.abs(synthetic - shares - gap) < 1, `gap at ${spot}`);
    }
    assert.equal(row.quotedDebit, 500);
    assert.ok(row.parityDebit != null && row.debit === row.parityDebit);
    assert.ok(row.legs.every((leg) => leg.iv != null && leg.iv === row.legs[0]?.iv));
    assert.equal(row.sizing.status, "sized");
    if (row.sizing.status === "sized") assert.ok(row.sizing.packages > 0);
  });

  it("refuses a strike that is not listed on both sides", () => {
    const mismatched = chainOf([contract("C", 140, 19, 21), contract("P", 145, 14, 16)]);
    const next = editLab(
      createLab(mismatched),
      {
        kind: "addStructure",
        label: "Synthetic",
        expiry: isoDate(EXPIRY),
        request: { template: "syntheticLong", strike: { by: "strike", strike: 140 } },
      },
      mismatched,
    );
    assert.equal(next.structures[0]?.resolveError, "The call and put did not land on the same strike.");
    assert.equal(next.structures[0]?.legs.length, 0);
  });
});
