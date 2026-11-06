import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  calendarDaysBetween,
  isoDate,
  makeOptionChain,
  type ChainDraft,
  type DraftContract,
  type OptionChain,
} from "@/lib/optionChain/chain";
import { createLab, editLab, evaluateLab, type PricedStructure } from "@/lib/strategyLab/lab";
import { settledShareDelta } from "@/lib/strategyLab/internal/pricing";
import {
  CAPPED_DELTA,
  DELTA_AT_SHORT_HINT,
  LEVERAGE_NOW_HINT,
  MAX_PROFIT_HINT,
  PEAK_LEVERAGE_HINT,
  RETURN_ON_DEBIT_HINT,
  deltaLabel,
  peakOmega,
  positionLeverage,
  readTarget,
  shortCallStrike,
  tileMetrics,
} from "@/lib/strategyLab/targetMetrics";

const JAN = "2029-01-19";

function calls(rows: readonly (readonly [number, number, number])[]): DraftContract[] {
  return rows.map(([strike, bid, ask]) => ({
    expiry: JAN,
    right: "C" as const,
    strike,
    bid,
    ask,
    feedIv: null,
    multiplier: 100,
    root: null,
  }));
}

function chainOf(): OptionChain {
  const body: ChainDraft = {
    symbol: "NOW",
    spot: 136.58,
    tradeDate: "2026-10-08",
    source: "cboe",
    dividendYieldHint: 0,
    quoteTime: null,
    fetchedAt: "2026-10-08T16:13:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
    delayed: true,
    contracts: calls([
      [120, 53.85, 59.25],
      [150, 43.4, 44.7],
      [160, 39.75, 41.75],
      [210, 27.75, 29.05],
    ]),
  };
  const built = makeOptionChain(body);
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

function priced(label: string): { chain: OptionChain; row: PricedStructure; rows: PricedStructure[]; evaluation: ReturnType<typeof evaluateLab> } {
  const chain = chainOf();
  const lab = editLab(
    createLab(chain),
    [
      { kind: "setAssumptions", patch: { rate: 0.04, dividendYield: 0, ivSource: "mid" } },
      {
        kind: "addStructure",
        label: "A",
        expiry: isoDate(JAN),
        request: { template: "callDebitSpread", long: { by: "strike", strike: 150 }, short: { by: "strike", strike: 210 } },
        entry: { kind: "limit", netPerShare: 15.55 },
      },
      {
        kind: "addStructure",
        label: "B",
        expiry: isoDate(JAN),
        request: { template: "callDebitSpread", long: { by: "strike", strike: 160 }, short: { by: "strike", strike: 210 } },
        entry: { kind: "limit", netPerShare: 12.35 },
      },
      {
        kind: "addStructure",
        label: "ZEBRA",
        expiry: isoDate(JAN),
        request: { template: "zebra", long: { by: "strike", strike: 120 }, short: { by: "strike", strike: 210 } },
        entry: { kind: "limit", netPerShare: 84.7 },
      },
    ],
    chain,
  );
  const evaluation = evaluateLab(lab, chain);
  const rows = evaluation.structures.filter((item): item is PricedStructure => item.status === "priced");
  const row = rows.find((item) => item.spec.label === label);
  assert.ok(row);
  if (!row) throw new Error("missing");
  return { chain, row, rows, evaluation };
}

const assumptions = { rate: 0.04, dividendYield: 0, ivSource: "mid" as const };

describe("leverage now, peak leverage, max profit, and return on debit", () => {
  it("works the $100 stock, $1,000, 100 delta-share example as 10× leverage now", () => {
    assert.equal(positionLeverage(100, 100, 1000), 10);
    assert.equal(positionLeverage(0.2, 100, 1000), null);
    assert.match(LEVERAGE_NOW_HINT, /\$100/);
    assert.match(LEVERAGE_NOW_HINT, /\$1,000/);
    assert.match(LEVERAGE_NOW_HINT, /10×/);
    assert.match(LEVERAGE_NOW_HINT, /Idle cash is not included/);
    assert.match(LEVERAGE_NOW_HINT, /today's model delta/i);
    assert.match(PEAK_LEVERAGE_HINT, /today's price curve/i);
    assert.match(PEAK_LEVERAGE_HINT, /does not divide a future share count/i);
    assert.match(MAX_PROFIT_HINT, /divided by the debit/i);
    assert.match(RETURN_ON_DEBIT_HINT, /target price and date/i);
    assert.match(DELTA_AT_SHORT_HINT, /share count, not leverage/i);
    assert.match(DELTA_AT_SHORT_HINT, /Nothing here is divided by the debit/);
    assert.doesNotMatch(LEVERAGE_NOW_HINT, /short strike at expiry/i);
  });

  it("settles a capped spread at 0 and a ZEBRA at +100 shares above 210", () => {
    const spread = [
      { right: "C" as const, strike: 150, ratio: 1 },
      { right: "C" as const, strike: 210, ratio: -1 },
    ];
    const zebra = [
      { right: "C" as const, strike: 120, ratio: 2 },
      { right: "C" as const, strike: 210, ratio: -1 },
    ];
    assert.equal(settledShareDelta(spread, 210), 0);
    assert.equal(settledShareDelta(spread, 180), 100);
    assert.equal(settledShareDelta(zebra, 210), 100);
    assert.equal(settledShareDelta(zebra, 180), 200);
    assert.equal(settledShareDelta(zebra, 100), 0);
    assert.equal(shortCallStrike(zebra), 210);
    assert.equal(shortCallStrike([{ right: "C", strike: 150, ratio: 1 }]), null);
  });

  it("reports leverage now, peak leverage, max profit, and return on debit", () => {
    const { chain, rows, evaluation } = priced("ZEBRA");
    const zebra = rows.find((row) => row.spec.label === "ZEBRA")!;
    const a = rows.find((row) => row.spec.label === "A")!;
    const b = rows.find((row) => row.spec.label === "B")!;
    assert.equal(zebra.sizing.status, "sized");
    assert.equal(a.sizing.status, "sized");
    assert.equal(b.sizing.status, "sized");
    if (zebra.sizing.status !== "sized" || a.sizing.status !== "sized" || b.sizing.status !== "sized") return;
    assert.equal(zebra.debit, 8470);
    assert.equal(zebra.sizing.packages, 1);
    assert.equal(zebra.sizing.invested, 8470);
    assert.equal(zebra.sizing.idleCash, 0);
    assert.equal(a.sizing.packages, 8470 / 1555);
    assert.equal(b.sizing.packages, 8470 / 1235);
    assert.equal(a.sizing.invested, 8470);
    assert.equal(b.sizing.invested, 8470);

    const atExpiry = (row: PricedStructure) =>
      readTarget({ row, assumptions, chain, date: isoDate(JAN), targetSpot: null });
    const z = atExpiry(zebra);
    const spreadA = atExpiry(a);
    const spreadB = atExpiry(b);
    assert.ok(z && spreadA && spreadB);
    if (!z || !spreadA || !spreadB || zebra.greeks == null || a.greeks == null || b.greeks == null) return;

    assert.equal(z.packageDelta, 100);
    assert.equal(z.positionDelta, 100);
    assert.equal(z.capped, false);
    assert.equal(z.pnl, 2 * (210 - 120) * 100 - 8470);
    assert.equal(z.multiple, (8470 + z.pnl!) / 8470);

    assert.equal(spreadA.packageDelta, 0);
    assert.equal(spreadB.packageDelta, 0);
    assert.equal(spreadA.capped, true);
    assert.equal(spreadB.capped, true);
    assert.equal(spreadA.insidePositionDelta, 100 * a.sizing.packages);
    assert.equal(spreadB.insidePositionDelta, 100 * b.sizing.packages);
    assert.equal(spreadA.pnl, ((210 - 150) * 100 - 1555) * a.sizing.packages);
    assert.equal(spreadB.pnl, ((210 - 160) * 100 - 1235) * b.sizing.packages);
    assert.match(deltaLabel(spreadA), /just inside/);
    assert.match(deltaLabel(spreadA), new RegExp(CAPPED_DELTA));
    assert.doesNotMatch(deltaLabel(spreadA), /×|leverage|debit/i);
    assert.match(deltaLabel(z), /^\+100$/);

    for (const row of [a, b, zebra]) {
      const read = atExpiry(row)!;
      const tile = tileMetrics({
        row,
        assumptions,
        spot: chain.spot,
        spots: evaluation.axis,
        entryDate: evaluation.entryDate,
        target: read,
      });
      assert.ok(tile);
      if (!tile || row.sizing.status !== "sized" || row.greeks == null || typeof row.risk.maxGain === "undefined") continue;
      const debit = row.debit * row.sizing.packages;
      const now = (row.greeks.delta * row.sizing.packages * chain.spot) / debit;
      assert.equal(tile.leverageNow, now);
      assert.ok(Math.abs((tile.leverageNow ?? 0) - (row.sizing.leverage ?? 0)) < 1e-9);
      const rejected = (100 * row.sizing.packages * 210) / debit;
      assert.ok(Math.abs((tile.leverageNow ?? 0) - rejected) > 1e-6);
      assert.ok(tile.peakLeverage != null && tile.peakSpot != null);
      assert.ok(tile.peakLeverage >= (tile.leverageNow ?? 0) - 1e-9);
      assert.ok(Math.abs(tile.peakLeverage - rejected) > 1e-6);
      if (row.spec.label !== "ZEBRA") {
        assert.ok((tile.leverageNow ?? 0) < rejected / 2);
        assert.ok((tile.peakLeverage ?? 0) < rejected / 2);
      }
      if (row.spec.label === "ZEBRA") {
        assert.equal(tile.maxProfitUnbounded, true);
        assert.equal(tile.maxProfitMultiple, null);
      } else {
        assert.equal(tile.maxProfitUnbounded, false);
        assert.equal(typeof row.risk.maxGain, "number");
        if (typeof row.risk.maxGain === "number") assert.equal(tile.maxProfitMultiple, (row.risk.maxGain * row.sizing.packages) / debit);
      }
      assert.equal(tile.returnOnDebit, read.pnl! / debit);
    }
  });

  it("models a pre-expiry delta at the short strike and accepts a typed target", () => {
    const { chain, row } = priced("ZEBRA");
    const today = readTarget({
      row,
      assumptions: { rate: 0.04, dividendYield: 0, ivSource: "mid" },
      chain,
      date: chain.tradeDate,
      targetSpot: null,
    });
    assert.ok(today && today.packageDelta != null);
    if (!today || today.packageDelta == null) return;
    assert.equal(today.settled, false);
    assert.ok(today.packageDelta > 90 && today.packageDelta < 110, `zebra delta at 210 today ${today.packageDelta}`);
    assert.equal(today.capped, false);
    assert.match(deltaLabel(today), /^\+/);

    const callOnly = editLab(
      createLab(chain),
      [
        { kind: "setAssumptions", patch: { rate: 0.04, dividendYield: 0, ivSource: "mid" } },
        {
          kind: "addStructure",
          label: "Call",
          expiry: isoDate(JAN),
          request: { template: "longCall", strike: { by: "strike", strike: 150 } },
          entry: { kind: "limit", netPerShare: 44 },
        },
      ],
      chain,
    );
    const call = evaluateLab(callOnly, chain).structures.find((item) => item.spec.label === "Call");
    assert.ok(call && call.status === "priced");
    if (!call || call.status !== "priced") return;
    assert.equal(readTarget({ row: call, assumptions: { rate: 0.04, dividendYield: 0, ivSource: "mid" }, chain, date: isoDate(JAN), targetSpot: null }), null);
    const aimed = readTarget({
      row: call,
      assumptions: { rate: 0.04, dividendYield: 0, ivSource: "mid" },
      chain,
      date: isoDate(JAN),
      targetSpot: 200,
    });
    assert.ok(aimed);
    if (!aimed) return;
    assert.equal(aimed.source, "override");
    assert.equal(aimed.packageDelta, 100);
    assert.match(deltaLabel(aimed), /^\+100$/);
    assert.doesNotMatch(deltaLabel(aimed), /×/);
  });

  it("keeps leverage now fixed when the typed target moves, and still reports the share delta", () => {
    const { chain, rows, evaluation } = priced("A");
    const a = rows.find((row) => row.spec.label === "A")!;
    const between = readTarget({ row: a, assumptions, chain, date: isoDate(JAN), targetSpot: 180 });
    assert.ok(between);
    if (!between || a.sizing.status !== "sized") return;
    assert.equal(between.capped, false);
    assert.equal(between.packageDelta, 100);
    assert.match(deltaLabel(between), /^\+/);
    const at180 = tileMetrics({
      row: a,
      assumptions,
      spot: chain.spot,
      spots: evaluation.axis,
      entryDate: evaluation.entryDate,
      target: between,
    });

    const above = readTarget({ row: a, assumptions, chain, date: isoDate(JAN), targetSpot: 250 });
    assert.ok(above);
    if (!above || !at180) return;
    assert.equal(above.capped, true);
    assert.equal(above.insidePositionDelta, null);
    assert.match(deltaLabel(above), new RegExp(CAPPED_DELTA));
    assert.doesNotMatch(deltaLabel(above), /×/);
    const at250 = tileMetrics({
      row: a,
      assumptions,
      spot: chain.spot,
      spots: evaluation.axis,
      entryDate: evaluation.entryDate,
      target: above,
    });
    assert.ok(at250);
    if (!at250) return;
    assert.equal(at250.leverageNow, at180.leverageNow);
    assert.equal(at250.peakLeverage, at180.peakLeverage);
    assert.equal(at250.peakSpot, at180.peakSpot);
    assert.notEqual(at250.returnOnDebit, at180.returnOnDebit);
    const rejected = (100 * a.sizing.packages * 210) / (a.debit * a.sizing.packages);
    assert.ok(Math.abs((at180.leverageNow ?? 0) - rejected) > 1);
    assert.ok(Math.abs((at180.peakLeverage ?? 0) - rejected) > 1);
  });

  it("divides leverage now by the debit, not by capital that includes idle cash", () => {
    const chain = chainOf();
    const lab = editLab(
      createLab(chain),
      [
        { kind: "setAssumptions", patch: { rate: 0.04, dividendYield: 0, ivSource: "mid" } },
        {
          kind: "addStructure",
          label: "ZEBRA",
          expiry: isoDate(JAN),
          request: { template: "zebra", long: { by: "strike", strike: 120 }, short: { by: "strike", strike: 210 } },
          entry: { kind: "limit", netPerShare: 84.7 },
        },
        { kind: "setBasis", basis: { kind: "equalCapital", capital: 10_000, units: "whole" } },
      ],
      chain,
    );
    const evaluation = evaluateLab(lab, chain);
    const row = evaluation.structures.find((item) => item.spec.label === "ZEBRA");
    assert.ok(row && row.status === "priced");
    if (!row || row.status !== "priced" || row.sizing.status !== "sized" || row.greeks == null) return;
    assert.equal(row.sizing.packages, 1);
    assert.equal(row.sizing.invested, 8470);
    assert.equal(row.sizing.idleCash, 1530);
    const read = readTarget({ row, assumptions, chain, date: isoDate(JAN), targetSpot: null });
    const tile = tileMetrics({
      row,
      assumptions,
      spot: chain.spot,
      spots: evaluation.axis,
      entryDate: evaluation.entryDate,
      target: read,
    });
    assert.ok(tile && read);
    if (!tile || !read) return;
    const debitLeverage = (row.greeks.delta * row.sizing.packages * chain.spot) / row.debit;
    const capitalLeverage = (row.greeks.delta * row.sizing.packages * chain.spot) / 10_000;
    assert.equal(tile.leverageNow, debitLeverage);
    assert.equal(tile.leverageNow, row.sizing.leverage);
    assert.ok(Math.abs((tile.leverageNow ?? 0) - capitalLeverage) > 0.01);
    const rejected = (100 * 210) / row.debit;
    assert.ok(Math.abs((tile.leverageNow ?? 0) - rejected) > 1e-6);
    assert.ok(tile.peakLeverage != null && Math.abs(tile.peakLeverage - rejected) > 1e-6);
  });

  it("picks the highest omega on the spots it is given", () => {
    const { chain, row } = priced("A");
    if (row.sizing.status === "needsCapitalOverride" || row.greeks == null) return;
    const low = positionLeverage(row.greeks.delta * row.sizing.packages, chain.spot, row.debit * row.sizing.packages);
    const found = peakOmega({
      legs: row.legs,
      assumptions,
      packages: row.sizing.packages,
      invested: row.debit * row.sizing.packages,
      spots: [chain.spot, chain.spot * 0.8, chain.spot * 1.2],
      years: calendarDaysBetween(chain.tradeDate, isoDate(JAN)) / 365,
    });
    assert.ok(found && low != null);
    if (!found || low == null) return;
    assert.ok(found.omega >= low - 1e-9);
    assert.ok([chain.spot, chain.spot * 0.8, chain.spot * 1.2].some((spot) => Math.abs(spot - found.spot) < 1e-9));
  });
});
