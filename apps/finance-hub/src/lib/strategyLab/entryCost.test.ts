import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isoDate, makeOptionChain, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { daysHeldFromLegs, resolveLegCost } from "@/lib/strategyLab/entryCost";
import { createLab, editLab, evaluateLab, type PricedStructure } from "@/lib/strategyLab/lab";
import { optionLeg, parseStoredLeg, legEntry } from "@/lib/strategyLab/legs";

function chain(contracts: DraftContract[]): OptionChain {
  const built = makeOptionChain({
    symbol: "TSLA",
    spot: 250,
    tradeDate: "2026-10-27",
    quoteTime: null,
    source: "cboe",
    delayed: true,
    dividendYieldHint: 0,
    contracts,
    fetchedAt: "2026-10-27T15:00:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
  });
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

const CALL: DraftContract = { expiry: "2027-01-15", right: "C", strike: 250, bid: 14, ask: 16, feedIv: 0.5, multiplier: 100, root: null };
const PUT: DraftContract = { expiry: "2027-01-15", right: "P", strike: 250, bid: 12, ask: 14, feedIv: 0.5, multiplier: 100, root: null };

function pnlAtSpot(ev: ReturnType<typeof evaluateLab>, spot: number): number {
  const row = priced(ev);
  const horizon = ev.horizons.find((item) => item.date === ev.entryDate)!;
  const point = row.curves.find((curve) => curve.horizonId === horizon.id)!.points.find((item) => item.spot === spot);
  assert.ok(point);
  return point!.pnl;
}

function priced(ev: ReturnType<typeof evaluateLab>): PricedStructure {
  const row = ev.structures[0];
  assert.ok(row && row.status === "priced");
  if (!row || row.status !== "priced") throw new Error("unreachable");
  return row;
}

describe("entry cost precedence", () => {
  it("uses manual, then book, then the mark", () => {
    const base = optionLeg({ right: "C", strike: 250, ratio: 1, expiry: isoDate("2027-01-15") });
    assert.equal(resolveLegCost(base, 15).source, "mark");
    assert.equal(resolveLegCost(base, 15).price, 15);
    const book = { ...base, bookPrice: 10, bookDate: isoDate("2026-09-27") };
    assert.equal(resolveLegCost(book, 15).source, "book");
    assert.equal(resolveLegCost(book, 15).price, 10);
    const manual = { ...book, manualPrice: 12, manualDate: isoDate("2026-09-01") };
    assert.equal(resolveLegCost(manual, 15).source, "manual");
    assert.equal(resolveLegCost(manual, 15).price, 12);
    assert.equal(resolveLegCost(manual, 15).date, "2026-09-01");
    assert.equal(daysHeldFromLegs([manual], isoDate("2026-10-27")), 56);
  });

  it("prices today off the book cost, and a manual price replaces it", () => {
    const live = chain([CALL]);
    const opened = editLab(createLab(live), {
      kind: "savePackage",
      label: "TSLA call",
      legs: [
        {
          instrument: "call",
          right: "C",
          strike: 250,
          ratio: 1,
          expiry: isoDate("2027-01-15"),
          bookPrice: 10,
          bookDate: isoDate("2026-09-27"),
          manualPrice: null,
          manualDate: null,
          missingCost: false,
        },
      ],
    }, live);
    const book = priced(evaluateLab(opened, live));
    assert.equal(book.debit, 1000);
    assert.equal(book.daysHeld, 30);

    const overridden = editLab(opened, { kind: "setLegCost", id: "s1", legIndex: 0, manualPrice: 12, manualDate: isoDate("2026-09-20") }, live);
    const manual = priced(evaluateLab(overridden, live));
    assert.equal(manual.debit, 1200);
    assert.equal(manual.spec.legs[0]?.manualPrice, 12);
    assert.equal(manual.daysHeld, 37);
    const cleared = editLab(overridden, { kind: "setLegCost", id: "s1", legIndex: 0, manualPrice: null, manualDate: null }, live);
    assert.equal(priced(evaluateLab(cleared, live)).debit, 1000);

    const marked = editLab(createLab(live), {
      kind: "addStructure",
      label: "Mark",
      expiry: isoDate("2027-01-15"),
      request: { template: "longCall", strike: { by: "strike", strike: 250 } },
    }, live);
    const atMark = priced(evaluateLab(marked, live));
    assert.equal(atMark.debit, 1500);
    assert.equal(atMark.daysHeld, null);
    assert.ok(Math.abs(pnlAtSpot(evaluateLab(opened, live), 250) - pnlAtSpot(evaluateLab(marked, live), 250) - 500) < 2);
  });

  it("keeps a book debit when the mark moves and skips parity", () => {
    const live = chain([CALL, PUT]);
    const lab = editLab(createLab(live), {
      kind: "savePackage",
      label: "Synthetic",
      legs: [
        {
          instrument: "call",
          right: "C",
          strike: 250,
          ratio: 1,
          expiry: isoDate("2027-01-15"),
          bookPrice: 10,
          bookDate: isoDate("2026-09-27"),
          manualPrice: null,
          manualDate: null,
          missingCost: false,
        },
        {
          instrument: "put",
          right: "P",
          strike: 250,
          ratio: -1,
          expiry: isoDate("2027-01-15"),
          bookPrice: 1,
          bookDate: isoDate("2026-09-27"),
          manualPrice: null,
          manualDate: null,
          missingCost: false,
        },
      ],
    }, live);
    const row = priced(evaluateLab(lab, live));
    assert.equal(row.debit, 900);
    assert.equal(row.parityDebit, null);
    const richer = { ...live, spot: 280 };
    assert.equal(priced(evaluateLab(lab, richer)).debit, 900);
  });

  it("flags a leg with no book cost and falls back to the mark", () => {
    const live = chain([CALL]);
    const lab = editLab(createLab(live), {
      kind: "savePackage",
      label: "Gap",
      legs: [
        {
          instrument: "call",
          right: "C",
          strike: 250,
          ratio: 1,
          expiry: isoDate("2027-01-15"),
          bookPrice: null,
          bookDate: null,
          manualPrice: null,
          manualDate: null,
          missingCost: true,
        },
      ],
    }, live);
    const ev = evaluateLab(lab, live);
    const row = priced(ev);
    assert.equal(row.debit, 1500);
    assert.ok(ev.issues.some((issue) => issue.code === "missing-cost"));
  });

  it("round-trips manual cost on a stored leg and still reads an old leg", () => {
    const stored = parseStoredLeg(
      {
        instrument: "call",
        right: "C",
        strike: 250,
        ratio: 1,
        expiry: "2027-01-15",
        entry: { kind: "mid", price: null },
        bookPrice: 10,
        bookDate: "2026-09-27",
        manualPrice: 12,
        manualDate: "2026-09-01",
        missingCost: false,
      },
      isoDate("2027-01-15"),
      legEntry("mid"),
    );
    assert.equal(stored?.manualPrice, 12);
    assert.equal(stored?.bookDate, "2026-09-27");
    const old = parseStoredLeg({ right: "C", strike: 100, ratio: 1 }, isoDate("2027-01-15"), legEntry("mid"));
    assert.equal(old?.bookPrice, null);
    assert.equal(old?.manualPrice, null);
    assert.equal(old?.missingCost, false);
  });
});
