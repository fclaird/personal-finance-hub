import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { impliedVol } from "@/lib/options/blackScholes";
import { createLab, editLab, evaluateLab } from "@/lib/strategyLab/lab";
import {
  calendarDaysBetween,
  isoDate,
  makeOptionChain,
  type ChainDraft,
  type DraftContract,
  type OptionChain,
} from "@/lib/optionChain/chain";
import {
  callSpreadVariations,
  deltaReadout,
  expiryForDuration,
  parseWidths,
  pinSelected,
  rankSpreads,
  scanAnchoredCallSpreads,
  scanCallSpreads,
  spreadShareDelta,
  variationCaption,
} from "@/lib/strategyLab/callSpreadOptimizer";
import { MODEL_DIVIDEND_YIELD, MODEL_RATE, modelAssumptionLabel, underlyingModelIv } from "@/lib/strategyLab/modelAssumptions";

const JAN = "2029-01-19";
const APR = "2027-04-16";

function contract(
  expiry: string,
  strike: number,
  bid: number,
  ask: number,
  openInterest?: number,
): DraftContract {
  return {
    expiry,
    right: "C",
    strike,
    bid,
    ask,
    feedIv: null,
    openInterest,
    multiplier: 100,
    root: null,
  };
}

function chainOf(contracts: readonly DraftContract[], spot = 100, tradeDate = "2026-10-08"): OptionChain {
  const body: ChainDraft = {
    symbol: "NOW",
    spot,
    tradeDate,
    source: "cboe",
    dividendYieldHint: 0,
    quoteTime: null,
    fetchedAt: "2026-10-08T16:13:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
    delayed: true,
    contracts,
  };
  const built = makeOptionChain(body);
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

describe("underlying model IV", () => {
  it("uses the call nearest spot when that expiry has only calls", () => {
    const chain = chainOf(
      [
        contract(JAN, 120, 53.85, 59.25),
        contract(JAN, 150, 43.4, 44.7),
        contract(JAN, 160, 39.75, 41.75),
        contract(JAN, 210, 27.75, 29.05),
      ],
      136.58,
    );
    const years = calendarDaysBetween(isoDate("2026-10-08"), isoDate(JAN)) / 365;
    const solved = impliedVol({
      right: "C",
      spot: 136.58,
      strike: 150,
      years,
      rate: MODEL_RATE,
      dividendYield: MODEL_DIVIDEND_YIELD,
      price: (43.4 + 44.7) / 2,
    });
    assert.equal(solved.ok, true);
    if (!solved.ok) return;
    const iv = underlyingModelIv(chain);
    assert.ok(iv != null);
    assert.ok(Math.abs((iv ?? 0) - solved.vol) < 1e-12);
    assert.match(modelAssumptionLabel(iv), /^IV \d+%, rate 4%, no dividends: model assumptions$/);
  });

  it("averages the call and the put at the shared at-the-money strike, then across expiries", () => {
    const chain = chainOf([
      contract(APR, 100, 8, 10),
      { ...contract(APR, 100, 7, 9), right: "P" },
      contract(JAN, 100, 20, 22),
      { ...contract(JAN, 100, 18, 20), right: "P" },
    ]);
    const iv = underlyingModelIv(chain);
    assert.ok(iv != null);
    const vols = [
      [APR, "C", 9],
      [APR, "P", 8],
      [JAN, "C", 21],
      [JAN, "P", 19],
    ] as const;
    const solved: number[] = [];
    for (const [expiry, right, price] of vols) {
      const years = calendarDaysBetween(isoDate("2026-10-08"), isoDate(expiry)) / 365;
      const one = impliedVol({
        right,
        spot: 100,
        strike: 100,
        years,
        rate: MODEL_RATE,
        dividendYield: MODEL_DIVIDEND_YIELD,
        price,
      });
      assert.equal(one.ok, true);
      if (one.ok) solved.push(one.vol);
    }
    const average = solved.reduce((sum, vol) => sum + vol, 0) / solved.length;
    assert.ok(Math.abs((iv ?? 0) - average) < 1e-12);
  });
});

describe("call debit spread scan", () => {
  const expiry = isoDate(APR);

  function quoted(): OptionChain {
    return chainOf([
      contract(APR, 90, 14, 16, 200),
      contract(APR, 100, 8, 10, 400),
      contract(APR, 110, 4, 6, 300),
      contract(APR, 120, 2, 3, 5),
    ]);
  }

  it("prices the debit from mids and leverage now from today's delta", () => {
    const scan = scanCallSpreads({
      chain: quoted(),
      expiry,
      widths: [10],
      minOpenInterest: 0,
      maxBidAsk: null,
      targetSpot: 110,
      horizon: "expiry",
    });
    const row = scan.rows.find((item) => item.longStrike === 100 && item.shortStrike === 110);
    assert.ok(row);
    if (!row) return;
    assert.equal(row.debitPerShare, 4);
    assert.equal(row.debit, 400);
    assert.equal(row.maxProfit, 600);
    assert.equal(row.profitToDebit, 1.5);
    assert.equal(row.breakeven, 104);
    assert.equal(row.breakevenDistance, 4);
    assert.equal(row.deltaJustInside, 100);
    assert.equal(row.deltaAtShortExpiry, 0);
    assert.ok(Math.abs(row.leverage - (row.netDelta * 100) / 400) < 1e-9);
    assert.notEqual(Math.round(row.leverage * 100), Math.round(((100 * 110) / 400) * 100));
    assert.ok(row.pop > 0 && row.pop < 1);
    assert.ok(row.probShort > 0 && row.probShort < row.pop);
    assert.equal(row.returnAtTarget, (1000 - 400) / 400);
  });

  it("steps to zero at the short strike on expiry and stays long just inside it", () => {
    const scan = scanCallSpreads({
      chain: quoted(),
      expiry,
      widths: [10],
      minOpenInterest: 0,
      maxBidAsk: null,
      targetSpot: 110,
      horizon: "today",
    });
    const row = scan.rows.find((item) => item.longStrike === 100 && item.shortStrike === 110);
    assert.ok(row);
    if (!row) return;
    assert.equal(spreadShareDelta(100, 110, 110, 0, row.iv), 0);
    assert.equal(spreadShareDelta(100, 110, 109.99, 0, row.iv), 100);
    const readout = deltaReadout(row, 100, scan.years, "expiry");
    const atShort = readout.find((item) => item.label === "Short strike");
    assert.equal(atShort?.delta, 0);
    const today = spreadShareDelta(100, 110, 100, scan.years, row.iv);
    assert.ok(today > 0 && today < 100);
  });

  it("drops illiquid strikes and keeps a requested width", () => {
    const open = scanCallSpreads({
      chain: quoted(),
      expiry,
      widths: null,
      minOpenInterest: 0,
      maxBidAsk: null,
      targetSpot: 110,
      horizon: "expiry",
    });
    assert.ok(open.rows.some((row) => row.longStrike === 100 && row.shortStrike === 120));
    const scan = scanCallSpreads({
      chain: quoted(),
      expiry,
      widths: [10],
      minOpenInterest: 50,
      maxBidAsk: null,
      targetSpot: 110,
      horizon: "expiry",
    });
    assert.ok(scan.rows.every((row) => row.shortStrike !== 120));
    assert.ok(scan.rows.every((row) => row.width === 10));
    assert.ok(scan.rows.some((row) => row.longStrike === 100 && row.shortStrike === 110));
    assert.deepEqual(parseWidths("10, 25"), [10, 25]);
    assert.equal(parseWidths("  "), null);
  });

  it("ranks a higher probability of profit ahead of a cheaper debit when that score is selected", () => {
    const scan = scanCallSpreads({
      chain: quoted(),
      expiry,
      widths: null,
      minOpenInterest: 0,
      maxBidAsk: 0.5,
      targetSpot: 120,
      horizon: "expiry",
    });
    const ranked = rankSpreads(scan.rows, "probability");
    assert.ok(ranked.length >= 2);
    assert.ok(ranked[0]!.pop >= ranked[1]!.pop);
    const byReturn = rankSpreads(scan.rows, "return");
    assert.ok(byReturn[0]!.returnAtTarget >= byReturn[byReturn.length - 1]!.returnAtTarget);
  });

  it("picks three months, six months, and the longest listed expiry", () => {
    const near = "2027-01-20";
    const withLeap = chainOf([
      contract(near, 100, 8, 9, 100),
      contract(APR, 100, 5, 6, 100),
      contract(JAN, 100, 20, 22, 100),
    ]);
    assert.equal(expiryForDuration(withLeap, "3m", null), isoDate(near));
    assert.equal(expiryForDuration(withLeap, "6m", null), isoDate(APR));
    assert.equal(expiryForDuration(withLeap, "leaps", null), isoDate(JAN));
    assert.equal(expiryForDuration(withLeap, "custom", isoDate(APR)), isoDate(APR));
  });

  it("loads into the lab with the one model IV on both legs", () => {
    const chain = quoted();
    const scan = scanCallSpreads({
      chain,
      expiry,
      widths: [10],
      minOpenInterest: 0,
      maxBidAsk: null,
      targetSpot: 110,
      horizon: "expiry",
    });
    const row = scan.rows.find((item) => item.longStrike === 100 && item.shortStrike === 110);
    assert.ok(row);
    if (!row) return;
    const lab = createLab(chain);
    const id = `s${lab.seq}`;
    const next = editLab(
      lab,
      [
        {
          kind: "addStructure",
          label: "100/110",
          expiry,
          request: { template: "callDebitSpread", long: { by: "strike", strike: 100 }, short: { by: "strike", strike: 110 } },
          entry: { kind: "mid" },
        },
        { kind: "setIvOverride", id, legIndex: 0, iv: row.iv },
        { kind: "setIvOverride", id, legIndex: 1, iv: row.iv },
      ],
      chain,
    );
    const priced = evaluateLab(next, chain).structures.find((item) => item.spec.id === id);
    assert.equal(priced?.status, "priced");
    if (priced?.status !== "priced") return;
    assert.equal(priced.legs[0]?.iv, row.iv);
    assert.equal(priced.legs[1]?.iv, row.iv);
    assert.equal(priced.spec.label, "100/110");
  });

  it("leaves a duration scan unmarked when no spread is picked", () => {
    const scan = scanCallSpreads({
      chain: quoted(),
      expiry,
      widths: [10],
      minOpenInterest: 0,
      maxBidAsk: null,
      targetSpot: 110,
      horizon: "expiry",
    });
    assert.ok(scan.rows.length > 0);
    assert.ok(scan.rows.every((row) => row.selected === false && row.variation === "scan"));
  });
});

describe("call debit spread variations", () => {
  const strikes = [90, 100, 110, 120, 130, 140, 150];

  it("steps both legs and widens or narrows from the picked strikes", () => {
    const rows = callSpreadVariations(strikes, 110, 130, 2);
    const key = (longStrike: number, shortStrike: number) => `${longStrike}/${shortStrike}`;
    const byKey = new Map(rows.map((row) => [key(row.longStrike, row.shortStrike), row]));
    assert.equal(byKey.get("110/130")?.kind, "selected");
    assert.equal(byKey.get("100/120")?.kind, "shift");
    assert.equal(byKey.get("100/120")?.steps, -1);
    assert.equal(byKey.get("120/140")?.kind, "shift");
    assert.equal(byKey.get("90/110")?.steps, -2);
    assert.equal(byKey.get("130/150")?.steps, 2);
    assert.equal(byKey.get("110/140")?.kind, "short");
    assert.equal(byKey.get("110/150")?.kind, "short");
    assert.equal(byKey.get("110/120")?.kind, "short");
    assert.equal(byKey.get("110/120")?.steps, -1);
    assert.equal(byKey.get("100/130")?.kind, "long");
    assert.equal(byKey.get("90/130")?.kind, "long");
    assert.equal(byKey.get("120/130")?.kind, "long");
    assert.equal(byKey.get("140/160"), undefined);
    assert.equal(byKey.get("110/110"), undefined);
    assert.equal(new Set(rows.map((row) => key(row.longStrike, row.shortStrike))).size, rows.length);
    assert.equal(rows.filter((row) => row.kind === "selected").length, 1);
    assert.equal(variationCaption("shift", -1), "Both strikes -1");
    assert.equal(variationCaption("short", 2), "Short strike +2");
    assert.equal(variationCaption("long", -2), "Long strike -2");
    assert.equal(variationCaption("selected", 0), "Selected");
  });

  it("prices the picked spread and keeps it first even when a neighbor scores higher", () => {
    const chain = chainOf(
      strikes.map((strike, index) => contract(APR, strike, 20 - index, 22 - index, 100)),
    );
    const open = scanAnchoredCallSpreads({
      chain,
      expiry: isoDate(APR),
      longStrike: 110,
      shortStrike: 130,
      minOpenInterest: 0,
      maxBidAsk: null,
      targetSpot: 140,
      horizon: "expiry",
    });
    const picked = open.rows.find((row) => row.longStrike === 110 && row.shortStrike === 130);
    assert.ok(picked);
    assert.equal(picked?.selected, true);
    assert.ok(open.rows.some((row) => row.variation === "shift"));
    assert.ok(open.rows.some((row) => row.variation === "long" || row.variation === "short"));
    assert.equal(pinSelected(rankSpreads(open.rows, "return"))[0]?.selected, true);
    const tight = scanAnchoredCallSpreads({
      chain,
      expiry: isoDate(APR),
      longStrike: 110,
      shortStrike: 130,
      minOpenInterest: 10_000,
      maxBidAsk: 0.01,
      targetSpot: 140,
      horizon: "expiry",
    });
    assert.deepEqual(
      tight.rows.map((row) => row.longStrike + "/" + row.shortStrike),
      ["110/130"],
    );
    assert.equal(tight.rows[0]?.selected, true);
  });
});
