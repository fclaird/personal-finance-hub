import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isoDate, makeOptionChain, type ChainDraft, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { createLab, editLab, evaluateLab, packageOutlay, type LabEvaluation, type PricedStructure } from "@/lib/strategyLab/lab";

const EXPIRY = "2027-06-18";

function contract(right: "C" | "P", strike: number, bid: number, ask: number): DraftContract {
  return { expiry: EXPIRY, right, strike, bid, ask, feedIv: null, multiplier: 100, root: null };
}

function chain(): OptionChain {
  const body: ChainDraft = {
    symbol: "NOW",
    spot: 450,
    tradeDate: "2026-10-08",
    source: "cboe",
    dividendYieldHint: null,
    quoteTime: null,
    fetchedAt: "2026-10-08T16:00:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
    delayed: true,
    contracts: [contract("C", 400, 118, 122), contract("C", 480, 48, 52), contract("C", 520, 28, 32)],
  };
  const built = makeOptionChain(body);
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

function priced(ev: LabEvaluation, label: string): PricedStructure {
  const row = ev.structures.find((item) => item.spec.label === label);
  assert.ok(row && row.status === "priced");
  if (!row || row.status !== "priced") throw new Error("unreachable");
  return row;
}

function board() {
  return editLab(
    createLab(chain()),
    [
      {
        kind: "addStructure",
        label: "B",
        expiry: isoDate(EXPIRY),
        request: { template: "callDebitSpread", long: { by: "strike", strike: 400 }, short: { by: "strike", strike: 480 } },
        entry: { kind: "limit", netPerShare: 10 },
      },
      {
        kind: "addStructure",
        label: "ZEBRA",
        expiry: isoDate(EXPIRY),
        request: { template: "zebra", long: { by: "strike", strike: 400 }, short: { by: "strike", strike: 520 } },
        entry: { kind: "limit", netPerShare: 217 },
      },
    ],
    chain(),
  );
}

describe("match the most expensive package", () => {
  const quotes = chain();

  it("is the default basis and gives the ZEBRA exactly one package", () => {
    assert.equal(createLab(quotes).basis.kind, "matchExpensive");
    const ev = evaluateLab(board(), quotes);
    const zebra = priced(ev, "ZEBRA");
    const spread = priced(ev, "B");
    assert.equal(zebra.debit, 21_700);
    assert.equal(spread.debit, 1_000);
    assert.deepEqual(ev.match, { capital: 21_700, label: "ZEBRA" });
    assert.equal(ev.metric, "P&L on $21,700, sized to match the ZEBRA");
    assert.equal(zebra.sizing.status, "sized");
    assert.equal(spread.sizing.status, "sized");
    if (zebra.sizing.status !== "sized" || spread.sizing.status !== "sized") return;
    assert.equal(zebra.sizing.packages, 1);
    assert.equal(zebra.sizing.invested, 21_700);
    assert.equal(zebra.sizing.idleCash, 0);
    assert.equal(spread.sizing.packages, 21.7);
    assert.equal(spread.sizing.invested, 21_700);
    assert.equal(spread.sizing.idleCash, 0);
    const pnl = zebra.curves.flatMap((curve) => curve.points.map((point) => point.pnl));
    assert.ok(pnl.some((value) => Math.abs(value) > 1));
  });

  it("scales the cheaper structure to the same invested dollars and divides exposure by invested", () => {
    const ev = evaluateLab(board(), quotes);
    for (const label of ["ZEBRA", "B"]) {
      const row = priced(ev, label);
      assert.equal(row.sizing.status, "sized");
      if (row.sizing.status !== "sized" || row.greeks == null) continue;
      const exposure = row.greeks.delta * row.sizing.packages * quotes.spot;
      assert.equal(row.sizing.leverage, exposure / row.sizing.invested);
      assert.equal(row.sizing.pnlPerPercent, exposure * 0.01);
      assert.notEqual(row.sizing.invested, 10_000);
    }
  });

  it("recomputes capital when the entry price changes", () => {
    const lab = board();
    const zebra = lab.structures.find((item) => item.label === "ZEBRA");
    assert.ok(zebra);
    const cheaper = editLab(lab, { kind: "setEntry", id: zebra.id, entry: { kind: "limit", netPerShare: 80 } }, quotes);
    const ev = evaluateLab(cheaper, quotes);
    assert.equal(priced(ev, "ZEBRA").debit, 8_000);
    assert.deepEqual(ev.match, { capital: 8_000, label: "ZEBRA" });
    const spread = priced(ev, "B");
    assert.equal(spread.sizing.status, "sized");
    if (spread.sizing.status === "sized") assert.equal(spread.sizing.packages, 8);
    const struck = editLab(cheaper, { kind: "setStrike", id: zebra.id, legIndex: 1, strike: 480 }, quotes);
    const moved = evaluateLab(struck, quotes);
    const movedZebra = priced(moved, "ZEBRA");
    const outlay = packageOutlay(movedZebra.debit, movedZebra.risk.maxLoss, movedZebra.spec.capitalOverride);
    assert.equal(moved.match?.capital, Math.max(outlay ?? 0, priced(moved, "B").debit));
  });
});
