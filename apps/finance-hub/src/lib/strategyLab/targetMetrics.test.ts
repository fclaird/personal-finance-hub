import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
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
  TARGET_LEVERAGE_HINT,
  costPerDeltaLine,
  deltaLabel,
  dollarsPerDelta,
  leverageQuotes,
  positionLeverage,
  readTarget,
  shortCallStrike,
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

function priced(label: string): { chain: OptionChain; row: PricedStructure; rows: PricedStructure[] } {
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
  const ev = evaluateLab(lab, chain);
  const rows = ev.structures.filter((item): item is PricedStructure => item.status === "priced");
  const row = rows.find((item) => item.spec.label === label);
  assert.ok(row);
  if (!row) throw new Error("missing");
  return { chain, row, rows };
}

describe("delta if the short strike is reached", () => {
  it("works the $100 stock, $1,000, 100 delta-share example as 10×", () => {
    assert.equal(positionLeverage(100, 100, 1000), 10);
    assert.equal(1000 / 100, 10);
    assert.match(TARGET_LEVERAGE_HINT, /\$100/);
    assert.match(TARGET_LEVERAGE_HINT, /\$1,000/);
    assert.match(TARGET_LEVERAGE_HINT, /\$10,000/);
    assert.match(TARGET_LEVERAGE_HINT, /10×/);
    assert.match(TARGET_LEVERAGE_HINT, /Idle cash is not in the denominator/);
    assert.match(TARGET_LEVERAGE_HINT, /long leg only/);
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

  it("uses the match-the-most-expensive basis and hand-checks expiry cost per delta", () => {
    const { chain, rows } = priced("ZEBRA");
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
      readTarget({ row, assumptions: { rate: 0.04, dividendYield: 0, ivSource: "mid" }, chain, date: isoDate(JAN), targetSpot: null });
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
    assert.equal(z.costPerDeltaTarget, 8470 / 100);
    assert.equal(z.costPerDeltaEntry, 8470 / zebra.greeks.delta);
    assert.equal(z.leverageAtTarget, (100 * 210) / 8470);
    assert.equal(z.insideLeverage, null);

    assert.equal(spreadA.packageDelta, 0);
    assert.equal(spreadB.packageDelta, 0);
    assert.equal(spreadA.capped, true);
    assert.equal(spreadB.capped, true);
    assert.equal(spreadA.costPerDeltaTarget, null);
    assert.equal(spreadA.insidePositionDelta, 100 * a.sizing.packages);
    assert.equal(spreadB.insidePositionDelta, 100 * b.sizing.packages);
    assert.equal(spreadA.insideLeverage, (100 * a.sizing.packages * 210) / 8470);
    assert.equal(spreadB.insideLeverage, (100 * b.sizing.packages * 210) / 8470);
    assert.equal(spreadA.costPerInsideDelta, 8470 / spreadA.insidePositionDelta!);
    assert.equal(spreadB.costPerInsideDelta, 8470 / spreadB.insidePositionDelta!);
    assert.equal(spreadA.pnl, ((210 - 150) * 100 - 1555) * a.sizing.packages);
    assert.equal(spreadB.pnl, ((210 - 160) * 100 - 1235) * b.sizing.packages);
    assert.match(costPerDeltaLine(spreadA), new RegExp(CAPPED_DELTA));
    assert.match(costPerDeltaLine(spreadA), /long leg only/);
    assert.match(costPerDeltaLine(z), /per delta at entry/);
    assert.match(costPerDeltaLine(z), /per delta at the short strike/);
    assert.match(deltaLabel(spreadA), /just inside/);
    assert.match(deltaLabel(z), /^\+100$/);

    assert.equal(dollarsPerDelta(z.costPerDeltaEntry!), "$84");
    assert.equal(dollarsPerDelta(z.costPerDeltaTarget!), "$85");
    assert.equal(dollarsPerDelta(spreadA.costPerDeltaEntry!), "$94");
    assert.equal(dollarsPerDelta(spreadB.costPerDeltaEntry!), "$92");
    assert.equal(dollarsPerDelta(spreadA.costPerInsideDelta!), "$16");
    assert.equal(dollarsPerDelta(spreadB.costPerInsideDelta!), "$12");

    for (const row of [a, b, zebra]) {
      const read = atExpiry(row)!;
      const quotes = leverageQuotes(row, chain.spot, read);
      assert.ok(quotes);
      if (!quotes || row.sizing.status !== "sized" || row.greeks == null) continue;
      const [expiry, entry, scenario] = quotes;
      assert.equal(expiry?.basis, "expiryShort");
      assert.equal(entry?.basis, "entry");
      assert.equal(scenario?.basis, "scenario");
      assert.equal(entry?.leverage, (row.greeks.delta * row.sizing.packages * chain.spot) / row.sizing.invested);
      assert.equal(entry?.leverage, row.sizing.leverage);
      assert.equal(scenario?.price, 210);
      if (row.spec.label === "ZEBRA") {
        assert.equal(expiry?.cappedBeyond, false);
        assert.equal(expiry?.delta, 100);
        assert.equal(expiry?.leverage, (100 * 210) / 8470);
        assert.equal(scenario?.leverage, expiry?.leverage);
        assert.match(expiry?.note ?? "", /just through the short strike/);
      } else {
        assert.equal(expiry?.cappedBeyond, true);
        assert.equal(expiry?.beyondDelta, 0);
        assert.equal(expiry?.delta, 100 * row.sizing.packages);
        assert.equal(expiry?.leverage, (100 * row.sizing.packages * 210) / 8470);
        assert.equal(scenario?.leverage, expiry?.leverage);
        assert.match(expiry?.note ?? "", /long leg only/i);
        assert.match(expiry?.note ?? "", /capped/);
      }
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
    assert.ok(today.costPerDeltaTarget != null);

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
    assert.match(costPerDeltaLine(aimed), /at the target/);
  });

  it("keeps the short-strike expiry reading when the typed target is somewhere else", () => {
    const { chain, rows } = priced("A");
    const a = rows.find((row) => row.spec.label === "A")!;
    const assumptions = { rate: 0.04, dividendYield: 0, ivSource: "mid" as const };
    const between = readTarget({ row: a, assumptions, chain, date: isoDate(JAN), targetSpot: 180 });
    assert.ok(between);
    if (!between || a.sizing.status !== "sized") return;
    assert.equal(between.capped, false);
    assert.equal(between.packageDelta, 100);
    assert.equal(between.leverageAtTarget, (100 * a.sizing.packages * 180) / a.sizing.invested);
    const quotes = leverageQuotes(a, chain.spot, between);
    assert.equal(quotes?.[0]?.price, 210);
    assert.equal(quotes?.[0]?.cappedBeyond, true);
    assert.equal(quotes?.[2]?.price, 180);
    assert.equal(quotes?.[2]?.leverage, between.leverageAtTarget);

    const above = readTarget({ row: a, assumptions, chain, date: isoDate(JAN), targetSpot: 250 });
    assert.ok(above);
    if (!above) return;
    assert.equal(above.capped, true);
    assert.equal(above.insideLeverage, null);
    assert.equal(above.leverageAtTarget, null);
    const aboveQuotes = leverageQuotes(a, chain.spot, above);
    assert.equal(aboveQuotes?.[2]?.leverage, null);
    assert.equal(aboveQuotes?.[2]?.cappedBeyond, true);
    assert.equal(aboveQuotes?.[0]?.leverage, (100 * a.sizing.packages * 210) / a.sizing.invested);
  });

  it("divides every leverage line by dollars invested, not by capital that includes idle cash", () => {
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
    const row = evaluateLab(lab, chain).structures.find((item) => item.spec.label === "ZEBRA");
    assert.ok(row && row.status === "priced");
    if (!row || row.status !== "priced" || row.sizing.status !== "sized" || row.greeks == null) return;
    assert.equal(row.sizing.packages, 1);
    assert.equal(row.sizing.invested, 8470);
    assert.equal(row.sizing.idleCash, 1530);
    const read = readTarget({
      row,
      assumptions: { rate: 0.04, dividendYield: 0, ivSource: "mid" },
      chain,
      date: isoDate(JAN),
      targetSpot: null,
    });
    const quotes = leverageQuotes(row, chain.spot, read);
    assert.ok(quotes);
    if (!quotes || !read) return;
    const investedLeverage = (row.greeks.delta * row.sizing.packages * chain.spot) / row.sizing.invested;
    const capitalLeverage = (row.greeks.delta * row.sizing.packages * chain.spot) / 10_000;
    assert.equal(quotes[1]?.leverage, investedLeverage);
    assert.ok(Math.abs((quotes[1]?.leverage ?? 0) - capitalLeverage) > 0.01);
    assert.equal(quotes[0]?.leverage, (100 * 210) / row.sizing.invested);
    assert.notEqual(quotes[0]?.leverage, (100 * 210) / 10_000);
    assert.equal(read.leverageAtTarget, (100 * 210) / row.sizing.invested);
  });
});
