import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { isoDate, makeOptionChain, type ChainDraft, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { createLab, editLab, evaluateLab, expiryPnlAtSpot, type PricedStructure } from "@/lib/strategyLab/lab";
import { applyVolShift } from "@/lib/strategyLab/internal/pricing";
import { booksFor, draftHeldSelection, draftHeldStructure, groupHeldPositions, stockFor, type HeldPositionRow } from "@/lib/strategyLab/positionsImport";
import { parseScenario } from "@/lib/strategyLab/scenarioStore";
import { deleteSnapshot, getSnapshot, saveSnapshot } from "@/lib/strategyLab/snapshotStore";
import { compactQuotes, provenanceFromChain } from "@/lib/strategyLab/snapshots";

const NEAR = "2027-01-15";
const FAR = "2027-06-18";

function chainFrom(body: ChainDraft): OptionChain {
  const built = makeOptionChain(body);
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

function priced(ev: ReturnType<typeof evaluateLab>, label?: string): PricedStructure {
  const row = label ? ev.structures.find((item) => item.spec.label === label) : ev.structures[0];
  assert.ok(row && row.status === "priced");
  if (!row || row.status !== "priced") throw new Error("unreachable");
  return row;
}

describe("held positions as legs", () => {
  const rows: HeldPositionRow[] = [
    {
      symbol: "PLTR  270115C00025000",
      quantity: -1,
      averagePrice: 2,
      securityType: "option",
      effectiveUnderlyingSymbol: "PLTR",
    },
    {
      symbol: "PLTR  270618P00020000",
      quantity: -1,
      averagePrice: 1.5,
      securityType: "option",
      effectiveUnderlyingSymbol: "PLTR",
    },
    { symbol: "PLTR", quantity: 100, averagePrice: 20, securityType: "equity", effectiveUnderlyingSymbol: "PLTR" },
    { symbol: "PLTR  270115C00030000", quantity: 101, averagePrice: 1, securityType: "option" },
  ];

  it("loads a covered call as a stock leg plus a short call at average cost", () => {
    const chain = chainFrom({
      symbol: "PLTR",
      spot: 20,
      tradeDate: "2026-10-09",
      quoteTime: null,
      source: "cboe",
      delayed: true,
      dividendYieldHint: 0,
      contracts: [
        { expiry: NEAR, right: "C", strike: 25, bid: 1.8, ask: 2.2, feedIv: 0.4, multiplier: 100, root: null },
        { expiry: FAR, right: "P", strike: 20, bid: 1, ask: 1.4, feedIv: 0.4, multiplier: 100, root: null },
      ] satisfies DraftContract[],
      fetchedAt: "2026-10-09T15:00:00.000Z",
      servedFrom: "network",
      fallbackFrom: null,
    });
    const groups = groupHeldPositions(rows);
    assert.equal(groups.oversized, 1);
    const books = booksFor(groups, "PLTR");
    assert.equal(books.length, 2);
    const near = books.find((book) => book.expiry === NEAR)!;
    const far = books.find((book) => book.expiry === FAR)!;
    const covered = draftHeldStructure({
      book: near,
      legIndexes: [0],
      stock: stockFor(groups, "PLTR"),
      includeStock: true,
    });
    assert.equal(covered.ok, true);
    if (!covered.ok) return;
    const lab = editLab(createLab(chain), [
      { kind: "setBasis", basis: { kind: "perPackage" } },
      {
        kind: "importHeld",
        expiry: covered.draft.expiry,
        label: covered.draft.label,
        legs: covered.draft.legs,
        netPerShare: covered.draft.netPerShare,
        stock: covered.draft.stock,
      },
    ], chain);
    const ev = evaluateLab(lab, chain);
    const row = priced(ev, "Covered 2027-01-15");
    const stock = row.spec.legs.find((leg) => leg.instrument === "stock");
    const call = row.spec.legs.find((leg) => leg.instrument === "call");
    assert.equal(stock?.quantity, 100);
    assert.equal(stock?.entry.price, 20);
    assert.equal(call?.side, "short");
    assert.equal(call?.strike, 25);
    assert.equal(row.spec.entry.kind, "limit");
    if (row.spec.entry.kind === "limit") assert.equal(row.spec.entry.netPerShare, -2);
    assert.equal(row.debit, 1800);
    assert.equal(expiryPnlAtSpot(row.legs, row.debit, 15), -300);
    assert.equal(expiryPnlAtSpot(row.legs, row.debit, 30), 700);

    const calendar = draftHeldSelection({
      books: [
        { book: near, legIndexes: [0] },
        { book: far, legIndexes: [0] },
      ],
      stock: null,
      includeStock: false,
    });
    assert.equal(calendar.ok, true);
    if (!calendar.ok) return;
    const both = editLab(createLab(chain), {
      kind: "importHeld",
      expiry: calendar.draft.expiry,
      label: calendar.draft.label,
      legs: calendar.draft.legs,
      netPerShare: calendar.draft.netPerShare,
      stock: null,
    }, chain);
    assert.equal(both.structures.length, 1);
    assert.deepEqual(
      both.structures[0]!.legs.map((leg) => leg.expiry),
      [NEAR, FAR],
    );
    assert.equal(both.structures[0]!.expiry, FAR);
  });
});

describe("vol shift on future marks", () => {
  it("moves a pre-expiry put mark and leaves the entry debit fixed", () => {
    const chain = chainFrom({
      symbol: "NOW",
      spot: 100,
      tradeDate: "2026-10-09",
      quoteTime: null,
      source: "cboe",
      delayed: true,
      dividendYieldHint: 0,
      contracts: [{ expiry: "2027-06-18", right: "P", strike: 100, bid: 8, ask: 9, feedIv: 0.3, multiplier: 100, root: null }],
      fetchedAt: "2026-10-09T15:00:00.000Z",
      servedFrom: "network",
      fallbackFrom: null,
    });
    const build = (amount: number) =>
      editLab(createLab(chain), [
        { kind: "setBasis", basis: { kind: "perPackage" } },
        { kind: "setHorizons", horizons: [{ kind: "entry" }, { kind: "date", date: isoDate("2027-01-15") }] },
        { kind: "setAssumptions", patch: { volShift: { mode: "points", amount } } },
        {
          kind: "addStructure",
          label: "Put",
          expiry: isoDate("2027-06-18"),
          request: { template: "longPut", strike: { by: "strike", strike: 100 } },
        },
        { kind: "setEntry", id: "s1", entry: { kind: "limit", netPerShare: 8.5 } },
      ], chain);
    const base = evaluateLab(build(0), chain);
    const shifted = evaluateLab(build(10), chain);
    assert.equal(priced(base, "Put").debit, priced(shifted, "Put").debit);
    assert.equal(priced(shifted, "Put").legs[0]?.iv, priced(base, "Put").legs[0]?.iv);
    const future = (ev: ReturnType<typeof evaluateLab>) => {
      const row = priced(ev, "Put");
      const horizon = ev.horizons.find((item) => item.date === "2027-01-15")!;
      return row.curves.find((curve) => curve.horizonId === horizon.id)!.points.find((point) => point.spot === 100)!.pnl;
    };
    assert.notEqual(future(shifted), future(base));
    assert.equal(expiryPnlAtSpot(priced(base, "Put").legs, priced(base, "Put").debit, 80), expiryPnlAtSpot(priced(shifted, "Put").legs, priced(shifted, "Put").debit, 80));
    assert.ok(Math.abs(applyVolShift(0.2, { mode: "points", amount: 10 }) - 0.3) < 1e-12);
  });
});

describe("strategy lab snapshots", () => {
  it("rejects a bad id and a scenario that is not an object", () => {
    const schema = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../db/schema.sql"), "utf8");
    const db = new Database(":memory:");
    db.exec(schema);
    assert.equal(getSnapshot(db, "nope"), null);
    assert.equal(saveSnapshot(db, "nope").ok, false);
    const chain = chainFrom({
      symbol: "NOW",
      spot: 100,
      tradeDate: "2026-10-09",
      quoteTime: null,
      source: "cboe",
      delayed: true,
      dividendYieldHint: 0,
      contracts: [{ expiry: NEAR, right: "C", strike: 100, bid: 9, ask: 11, feedIv: 0.3, multiplier: 100, root: null }],
      fetchedAt: "2026-10-09T15:00:00.000Z",
      servedFrom: "network",
      fallbackFrom: null,
    });
    const lab = editLab(createLab(chain), {
      kind: "addStructure",
      label: "Call",
      expiry: isoDate(NEAR),
      request: { template: "longCall", strike: { by: "strike", strike: 100 } },
    }, chain);
    const broken = JSON.parse(JSON.stringify(lab)) as { assumptions: { volShift: { mode: string; amount: number } } };
    broken.assumptions.volShift.mode = "gap";
    assert.equal(parseScenario(broken), null);
    const saved = saveSnapshot(
      db,
      { scenario: lab, quotes: compactQuotes(chain, lab), provenance: provenanceFromChain(chain), summary: "NOW call" },
      "2026-10-09T18:00:00.000Z",
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.match(saved.row.id, /^[0-9a-f-]{36}$/i);
    assert.equal(deleteSnapshot(db, "not-an-id").ok, false);
    assert.equal(deleteSnapshot(db, saved.row.id).ok, true);
    db.close();
  });
});
