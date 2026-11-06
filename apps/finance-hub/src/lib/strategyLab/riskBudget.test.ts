import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isoDate, makeOptionChain, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { createLab, editLab, evaluateLab } from "@/lib/strategyLab/lab";
import { stockLeg } from "@/lib/strategyLab/legs";

const EXPIRY = "2027-01-15";

function chainOf(contracts: DraftContract[]): OptionChain {
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

function contract(right: "C" | "P", strike: number, bid: number, ask: number): DraftContract {
  return { expiry: EXPIRY, right, strike, bid, ask, feedIv: null, multiplier: 100, root: null };
}

describe("risk budget", () => {
  const chain = chainOf([
    contract("P", 80, 1.8, 2.2),
    contract("P", 90, 3, 3.4),
    contract("C", 100, 4, 4.4),
    contract("C", 110, 2, 2.4),
    contract("C", 120, 1, 1.4),
  ]);

  it("gives a short strangle two breakevens and waits on the call side", () => {
    const lab = editLab(
      createLab(chain),
      [
        { kind: "setBasis", basis: { kind: "equalCapital", capital: 30_000, units: "whole" } },
        {
          kind: "addStructure",
          label: "Strangle",
          expiry: isoDate(EXPIRY),
          request: {
            template: "custom",
            legs: [
              { right: "P", strike: 90, ratio: -1 },
              { right: "C", strike: 110, ratio: -1 },
            ],
          },
        },
      ],
      chain,
    );
    const ev = evaluateLab(lab, chain);
    const row = ev.structures[0];
    assert.ok(row && row.status === "priced");
    if (!row || row.status !== "priced") return;
    assert.equal(row.risk.breakevens.length, 2);
    assert.equal(row.risk.maxLossUp, "unbounded");
    assert.notEqual(row.risk.maxLossDown, "flat");
    assert.equal(row.putProxy, 9_000);
    assert.equal(row.packageCost, null);
    assert.equal(row.sizing.status, "needsCapitalOverride");
    const typed = editLab(lab, { kind: "setCapitalOverride", id: row.spec.id, dollars: 2_000 }, chain);
    const next = evaluateLab(typed, chain).structures[0];
    assert.ok(next && next.status === "priced" && next.sizing.status === "sized");
    if (!next || next.status !== "priced" || next.sizing.status !== "sized") return;
    assert.equal(next.packageCost, 11_000);
    assert.equal(next.sizing.packages, 2);
  });

  it("sizes a short put on the cash-secured proxy and a short straddle on two breakevens", () => {
    const lab = editLab(
      createLab(chain),
      [
        { kind: "setBasis", basis: { kind: "equalCapital", capital: 10_000, units: "whole" } },
        {
          kind: "addStructure",
          label: "Put",
          expiry: isoDate(EXPIRY),
          request: { template: "custom", legs: [{ right: "P", strike: 80, ratio: -1 }] },
        },
        {
          kind: "addStructure",
          label: "Straddle",
          expiry: isoDate(EXPIRY),
          request: {
            template: "custom",
            legs: [
              { right: "C", strike: 100, ratio: -1 },
              { right: "P", strike: 100, ratio: -1 },
            ],
          },
        },
      ],
      chain,
    );
    const putChain = chainOf([contract("P", 100, 4, 4.4), contract("C", 100, 4, 4.4)]);
    const straddleLab = editLab(
      createLab(putChain),
      {
        kind: "addStructure",
        label: "Straddle",
        expiry: isoDate(EXPIRY),
        request: {
          template: "custom",
          legs: [
            { right: "C", strike: 100, ratio: -1 },
            { right: "P", strike: 100, ratio: -1 },
          ],
        },
      },
      putChain,
    );
    const ev = evaluateLab(lab, chain);
    const put = ev.structures.find((row) => row.spec.label === "Put");
    assert.ok(put && put.status === "priced" && put.sizing.status === "sized");
    if (!put || put.status !== "priced" || put.sizing.status !== "sized") return;
    assert.equal(put.risk.breakevens.length, 1);
    assert.equal(put.packageCost, 8_000);
    assert.notEqual(put.packageCost, put.risk.maxLoss);
    assert.equal(put.sizing.packages, 1);
    assert.equal(put.risk.maxLossDown === "flat" ? "" : "to zero", "to zero");
    const straddle = evaluateLab(straddleLab, putChain).structures[0];
    assert.ok(straddle && straddle.status === "priced");
    if (!straddle || straddle.status !== "priced") return;
    assert.equal(straddle.risk.breakevens.length, 2);
    assert.ok(straddle.risk.breakevens[0]! < 100 && straddle.risk.breakevens[1]! > 100);
  });

  it("prices a call credit spread on width minus credit", () => {
    const lab = editLab(
      createLab(chain),
      {
        kind: "addStructure",
        label: "Credit",
        expiry: isoDate(EXPIRY),
        request: {
          template: "custom",
          legs: [
            { right: "C", strike: 110, ratio: -1 },
            { right: "C", strike: 120, ratio: 1 },
          ],
        },
      },
      chain,
    );
    const row = evaluateLab(lab, chain).structures[0];
    assert.ok(row && row.status === "priced");
    if (!row || row.status !== "priced") return;
    const credit = -row.debit;
    assert.ok(credit > 0);
    assert.equal(row.packageCost, 10 * 100 - credit);
    assert.equal(row.callRiskRequired, false);
    assert.equal(row.risk.maxLossUp, 10 * 100 - credit);
  });

  it("treats a covered call as defined and a naked short call as undefined", () => {
    const started = editLab(
      createLab(chain),
      {
        kind: "addStructure",
        label: "Call",
        expiry: isoDate(EXPIRY),
        request: { template: "custom", legs: [{ right: "C", strike: 110, ratio: -1 }] },
      },
      chain,
    );
    const naked = evaluateLab(started, chain).structures[0];
    assert.ok(naked && naked.status === "priced");
    if (!naked || naked.status !== "priced") return;
    assert.equal(naked.callRiskRequired, true);
    assert.equal(naked.packageCost, null);
    assert.equal(naked.sizing.status, "needsCapitalOverride");
    const spec = started.structures[0]!;
    const coveredLab = {
      ...started,
      structures: [{ ...spec, legs: [...spec.legs, stockLeg(100, 100, "shares")] }],
    };
    const covered = evaluateLab(coveredLab, chain).structures[0];
    assert.ok(covered && covered.status === "priced");
    if (!covered || covered.status !== "priced") return;
    assert.equal(covered.callRiskRequired, false);
    assert.equal(covered.risk.slopeAbove, 0);
    assert.ok(covered.packageCost != null && covered.packageCost > 0);
    assert.equal(covered.sizing.status === "needsCapitalOverride", false);
  });

  it("matches the structure with the larger package cost", () => {
    const lab = editLab(
      createLab(chain),
      [
        { kind: "setBasis", basis: { kind: "matchExpensive" } },
        {
          kind: "addStructure",
          label: "Put",
          expiry: isoDate(EXPIRY),
          request: { template: "custom", legs: [{ right: "P", strike: 80, ratio: -1 }] },
        },
        {
          kind: "addStructure",
          label: "Call",
          expiry: isoDate(EXPIRY),
          request: { template: "longCall", strike: { by: "strike", strike: 100 } },
        },
      ],
      chain,
    );
    const ev = evaluateLab(lab, chain);
    assert.equal(ev.match?.label, "Put");
    assert.equal(ev.match?.capital, 8_000);
  });
});
