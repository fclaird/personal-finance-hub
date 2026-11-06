import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { describe, it } from "node:test";

import { addCalendarDays, isoDate, makeOptionChain, type ChainDraft, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { profitSideSpan } from "@/lib/strategyLab/chartView";
import { sampleStructureDelta } from "@/lib/strategyLab/deltaCurves";
import { createLab, editLab, evaluateLab, type PricedStructure } from "@/lib/strategyLab/lab";
import { markAt } from "@/lib/strategyLab/internal/pricing";
import { MODEL_DIVIDEND_YIELD, MODEL_RATE } from "@/lib/strategyLab/modelAssumptions";
import { readTarget, targetStrike, tileMetrics } from "@/lib/strategyLab/targetMetrics";

const NEAR = "2027-01-15";
const FAR = "2027-06-18";

function draft(contracts: DraftContract[]): ChainDraft {
  return {
    symbol: "NOW",
    spot: 140,
    tradeDate: "2026-10-08",
    quoteTime: null,
    source: "cboe",
    delayed: true,
    dividendYieldHint: 0,
    contracts,
    fetchedAt: "2026-10-08T16:00:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
  };
}

function contract(expiry: string, right: "C" | "P", strike: number, bid: number, ask: number): DraftContract {
  return { expiry, right, strike, bid, ask, feedIv: null, multiplier: 100, root: null };
}

function chainOf(): OptionChain {
  const built = makeOptionChain(
    draft([
      contract(NEAR, "C", 120, 22, 24),
      contract(NEAR, "C", 140, 10, 12),
      contract(NEAR, "C", 160, 3, 4),
      contract(NEAR, "P", 120, 2, 3),
      contract(NEAR, "P", 140, 8, 10),
      contract(NEAR, "P", 160, 20, 22),
      contract(FAR, "C", 140, 16, 18),
      contract(FAR, "P", 140, 12, 14),
    ]),
  );
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

function priced(label: string, ev: ReturnType<typeof evaluateLab>): PricedStructure {
  const row = ev.structures.find((item) => item.spec.label === label);
  assert.ok(row && row.status === "priced");
  if (!row || row.status !== "priced") throw new Error("unreachable");
  return row;
}

describe("charts and metrics on legs", () => {
  const chain = chainOf();
  const assumptions = { rate: MODEL_RATE, dividendYield: MODEL_DIVIDEND_YIELD, ivSource: "mid" as const };

  it("puts a long put and a put debit below zero and keeps a finite debit", () => {
    const lab = editLab(createLab(chain), [
      {
        kind: "addStructure",
        label: "Long put",
        expiry: isoDate(NEAR),
        request: { template: "longPut", strike: { by: "strike", strike: 140 } },
      },
      {
        kind: "addStructure",
        label: "Put debit",
        expiry: isoDate(NEAR),
        request: { template: "putDebit", long: { by: "strike", strike: 160 }, short: { by: "strike", strike: 140 } },
      },
    ], chain);
    const ev = evaluateLab(lab, chain);
    const horizon = ev.horizons.find((item) => !item.settlement)!;
    for (const label of ["Long put", "Put debit"] as const) {
      const row = priced(label, ev);
      assert.ok(row.debit > 0);
      const delta = sampleStructureDelta(ev, row.spec.id, horizon.id, 140, "package", "delta");
      assert.ok(delta != null && delta < 0, `${label} delta ${delta}`);
    }
  });

  it("keeps a synthetic delta near 100 shares before expiry", () => {
    const lab = editLab(createLab(chain), {
      kind: "addStructure",
      label: "Synthetic",
      expiry: isoDate(NEAR),
      request: { template: "syntheticLong", strike: { by: "strike", strike: 140 } },
    }, chain);
    const ev = evaluateLab(lab, chain);
    const row = priced("Synthetic", ev);
    const horizon = ev.horizons.find((item) => item.date === chain.tradeDate)!;
    for (const spot of [120, 140, 160]) {
      const delta = sampleStructureDelta(ev, row.spec.id, horizon.id, spot, "package", "delta");
      assert.ok(delta != null && Math.abs(delta - 100) < 5, `spot ${spot} delta ${delta}`);
    }
  });

  it("leaves credit omega blank and divides the return by the package cost", () => {
    const lab = editLab(createLab(chain), {
      kind: "addStructure",
      label: "Call credit",
      expiry: isoDate(NEAR),
      request: { template: "callCredit", short: { by: "strike", strike: 140 }, long: { by: "strike", strike: 160 } },
    }, chain);
    const ev = evaluateLab(lab, chain);
    const row = priced("Call credit", ev);
    assert.ok(row.debit <= 0);
    assert.ok(row.packageCost != null && row.packageCost > 0);
    const width = 20 * 100;
    assert.equal(row.packageCost, width - Math.abs(row.debit));
    const target = readTarget({ row, assumptions, chain, date: chain.tradeDate, targetSpot: 140 });
    const tile = tileMetrics({
      row,
      assumptions,
      spot: chain.spot,
      spots: ev.axis,
      entryDate: ev.entryDate,
      target,
    });
    assert.ok(tile);
    assert.equal(tile!.leverageNow, null);
    assert.equal(tile!.peakLeverage, null);
    assert.equal(tile!.returnBasis, "risk");
    assert.equal(typeof row.risk.maxGain, "number");
    if (typeof row.risk.maxGain === "number" && row.sizing.status === "sized") {
      assert.equal(tile!.maxProfitMultiple, (row.risk.maxGain * row.sizing.packages) / (row.packageCost! * row.sizing.packages));
    }
    assert.ok(target?.pnl != null && row.sizing.status === "sized");
    if (target?.pnl != null && row.sizing.status === "sized") {
      assert.equal(tile!.returnOnDebit, target.pnl / (row.packageCost! * row.sizing.packages));
    }
    assert.equal(targetStrike(row.legs), 140);
    assert.equal(
      targetStrike([
        { right: "P", strike: 120, ratio: -1 },
        { right: "C", strike: 160, ratio: -1 },
      ]),
      null,
    );
    assert.equal(targetStrike([{ right: "P", strike: 150, ratio: -1 }]), 150);
  });

  it("drops the near calendar leg's time value on the front expiry and keeps the far leg", () => {
    const lab = editLab(createLab(chain), {
      kind: "addStructure",
      label: "Calendar",
      expiry: isoDate(FAR),
      request: { template: "calendar", right: "C", front: isoDate(NEAR), strike: { by: "strike", strike: 140 } },
    }, chain);
    const ev = evaluateLab(lab, chain);
    const row = priced("Calendar", ev);
    const before = addCalendarDays(isoDate(NEAR), -1);
    const slope = (date: typeof before) => {
      const left = markAt(chain, row.spec.expiry, row.legs, assumptions, 139, date);
      const right = markAt(chain, row.spec.expiry, row.legs, assumptions, 141, date);
      assert.ok(left != null && right != null);
      return right! - left!;
    };
    assert.notEqual(slope(before), slope(isoDate(NEAR)));
    const onFront = markAt(chain, row.spec.expiry, row.legs, assumptions, 140, isoDate(NEAR));
    const farOnly = row.legs.filter((leg) => leg.expiry === FAR);
    const far = markAt(chain, row.spec.expiry, farOnly, assumptions, 140, isoDate(NEAR));
    assert.ok(onFront != null && far != null && far > 0);
  });

  it("fits a short strangle between the breakevens and a long strangle onto a wing", () => {
    const short = [];
    const long = [];
    for (let x = 80; x <= 200; x += 2) {
      short.push({ x, y: x > 120 && x < 160 ? 200 : -400 });
      long.push({ x, y: x < 120 || x > 160 ? 400 : -200 });
    }
    const between = profitSideSpan(short, 140);
    assert.ok(between);
    assert.ok(between.min > 110 && between.max < 175);
    assert.ok(between.min < 130 && between.max > 150);
    const wing = profitSideSpan(long, 140);
    assert.ok(wing);
    assert.ok(wing.min < 120 || wing.max > 160);
    assert.ok(wing.min < 140 && wing.max > 140);
    assert.ok(wing.min > 80 && wing.max < 200);
  });

  it("keeps the fitted chart height inside 70vh", () => {
    const source = readFileSync(new URL("../../app/components/strategyLab/StrategyPlot.tsx", import.meta.url), "utf8");
    assert.match(source, /clamp\(420px, 70vh, 900px\)/);
  });
});
