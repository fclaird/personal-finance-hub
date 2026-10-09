import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

import { isoDate, makeOptionChain, type ChainDraft, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { bsmPrice, normCdf } from "@/lib/options/blackScholes";
import { entryTableCsv, evaluationCubeCsv } from "@/lib/strategyLab/exportCsv";
import { createLab, editLab, evaluateLab, expiryPnlAtSpot, type PricedStructure } from "@/lib/strategyLab/lab";
import { applyVolShift, describeVolShift } from "@/lib/strategyLab/internal/pricing";
import { booksFor, draftHeldStructure, groupHeldPositions, stockFor, type HeldPositionRow } from "@/lib/strategyLab/positionsImport";
import { parseScenario } from "@/lib/strategyLab/scenarioStore";
import { deleteSnapshot, getSnapshot, listSnapshots, saveSnapshot } from "@/lib/strategyLab/snapshotStore";
import { compactQuotes, provenanceFromChain } from "@/lib/strategyLab/snapshots";

const EXPIRY = "2027-01-15";

function draft(symbol: string, spot: number, tradeDate: string, contracts: DraftContract[]): ChainDraft {
  return {
    symbol,
    spot,
    tradeDate,
    quoteTime: "2026-10-09T15:00:00.000Z",
    source: "cboe",
    delayed: true,
    dividendYieldHint: 0,
    contracts,
    fetchedAt: "2026-10-09T15:00:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
  };
}

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

function pnlOn(ev: ReturnType<typeof evaluateLab>, date: string, spot: number, label?: string): number {
  const row = priced(ev, label);
  const horizon = ev.horizons.find((item) => item.date === date);
  assert.ok(horizon);
  const curve = row.curves.find((item) => item.horizonId === horizon.id);
  const point = curve?.points.find((item) => item.spot === spot);
  assert.ok(point);
  return point.pnl;
}

describe("phase 3 position import", () => {
  const rows: HeldPositionRow[] = [
    {
      positionId: "call",
      accountId: "acct",
      symbol: "PLTR  270115C00025000",
      quantity: -1,
      averagePrice: 2,
      securityType: "option",
      effectiveUnderlyingSymbol: "PLTR",
    },
    {
      positionId: "put-a",
      accountId: "acct",
      symbol: "PLTR  270115P00020000",
      quantity: -1,
      averagePrice: 1.2,
      securityType: "option",
    },
    {
      positionId: "put-b",
      accountId: "acct",
      symbol: "PLTR  270115P00020000",
      quantity: -1,
      averagePrice: 1.8,
      securityType: "option",
    },
    {
      symbol: "PLTR",
      quantity: 100,
      averagePrice: 20,
      securityType: "equity",
      effectiveUnderlyingSymbol: "PLTR",
    },
    { symbol: "NOTANOPTION", quantity: 1, averagePrice: 1, securityType: "option" },
    { symbol: "PLTR  270115C00030000", quantity: 101, averagePrice: 1, securityType: "option" },
  ];

  it("groups short calls and short puts with the share lot, and skips what it cannot use", () => {
    const groups = groupHeldPositions(rows);
    assert.equal(groups.unparsed, 1);
    assert.equal(groups.oversized, 1);
    const stock = stockFor(groups, "PLTR");
    assert.equal(stock?.shares, 100);
    assert.equal(stock?.averagePrice, 20);
    const books = booksFor(groups, "PLTR");
    assert.equal(books.length, 1);
    assert.equal(books[0]?.expiry, "2027-01-15");
    const call = books[0]?.legs.find((leg) => leg.right === "C");
    const put = books[0]?.legs.find((leg) => leg.right === "P");
    assert.equal(call?.quantity, -1);
    assert.equal(call?.averagePrice, 2);
    assert.equal(put?.quantity, -2);
    assert.equal(put?.contribution, -3);
    assert.equal(put?.averagePrice, 1.5);

    const covered = draftHeldStructure({
      book: books[0]!,
      legIndexes: [books[0]!.legs.findIndex((leg) => leg.right === "C")],
      stock,
      includeStock: true,
    });
    assert.equal(covered.ok, true);
    if (!covered.ok) return;
    assert.equal(covered.draft.label, "Covered 2027-01-15");
    assert.equal(covered.draft.netPerShare, -2);
    assert.deepEqual(covered.draft.stock, { shares: 100, averagePrice: 20 });
    assert.deepEqual(covered.draft.legs, [{ right: "C", strike: 25, ratio: -1 }]);

    const naked = draftHeldStructure({
      book: books[0]!,
      legIndexes: [books[0]!.legs.findIndex((leg) => leg.right === "C")],
      stock,
      includeStock: false,
    });
    assert.equal(naked.ok, true);
    if (!naked.ok) return;
    assert.equal(naked.draft.label, "Held 2027-01-15");
    assert.equal(naked.draft.stock, null);

    const puts = draftHeldStructure({
      book: books[0]!,
      legIndexes: [books[0]!.legs.findIndex((leg) => leg.right === "P")],
      stock: null,
      includeStock: false,
    });
    assert.equal(puts.ok, true);
    if (!puts.ok) return;
    assert.equal(puts.draft.legs[0]?.ratio, -2);
    assert.equal(puts.draft.netPerShare, -3);
  });

  it("prices a covered call at average cost and lets a copy change strikes", () => {
    const chain = chainFrom(
      draft("PLTR", 20, "2026-10-09", [
        { expiry: EXPIRY, right: "C", strike: 25, bid: 1.8, ask: 2.2, feedIv: 0.4, multiplier: 100, root: null },
        { expiry: EXPIRY, right: "C", strike: 30, bid: 0.8, ask: 1.2, feedIv: 0.4, multiplier: 100, root: null },
      ]),
    );
    const groups = groupHeldPositions(rows);
    const book = booksFor(groups, "PLTR")[0]!;
    const covered = draftHeldStructure({
      book,
      legIndexes: [book.legs.findIndex((leg) => leg.right === "C")],
      stock: stockFor(groups, "PLTR"),
      includeStock: true,
    });
    assert.equal(covered.ok, true);
    if (!covered.ok) return;
    const lab = editLab(
      createLab(chain),
      [
        { kind: "setBasis", basis: { kind: "perPackage" } },
        {
          kind: "importHeld",
          expiry: covered.draft.expiry,
          label: covered.draft.label,
          legs: covered.draft.legs,
          netPerShare: covered.draft.netPerShare,
          stock: covered.draft.stock,
        },
      ],
      chain,
    );
    const ev = evaluateLab(lab, chain);
    const row = priced(ev, "Covered 2027-01-15");
    assert.equal(row.spec.entry.kind, "limit");
    if (row.spec.entry.kind === "limit") assert.equal(row.spec.entry.netPerShare, -2);
    assert.equal(row.debit, 1800);
    assert.equal(expiryPnlAtSpot(row.legs, row.debit, 15, row.spec.stock), -300);
    assert.equal(expiryPnlAtSpot(row.legs, row.debit, 30, row.spec.stock), 700);
    assert.equal(row.risk.breakevens[0], 18);
    assert.equal(row.risk.maxGain, 700);
    assert.notEqual(row.risk.maxLoss, "unbounded");
    const bare = priced(evaluateLab(editLab(lab, { kind: "setStock", id: row.spec.id, stock: null }, chain), chain));
    assert.ok(row.greeks && bare.greeks);
    assert.ok(Math.abs(row.greeks!.delta - bare.greeks!.delta - 100) < 1e-6);

    const copied = editLab(lab, { kind: "duplicateStructure", id: row.spec.id }, chain);
    assert.equal(copied.structures.length, 2);
    const alt = copied.structures[1]!;
    assert.equal(alt.label, "Covered 2027-01-15 alt");
    assert.equal(alt.stock?.shares, 100);
    assert.equal(alt.entry.kind, "limit");
    const moved = editLab(copied, { kind: "setStrike", id: alt.id, legIndex: 0, strike: 30 }, chain);
    assert.equal(moved.structures[0]?.legs[0]?.strike, 25);
    assert.equal(moved.structures[1]?.legs[0]?.strike, 30);
    const both = evaluateLab(moved, chain);
    assert.equal(both.structures.filter((item) => item.status === "priced").length, 2);
    assert.equal(both.expiryBoards.length > 0, true);
  });

  it("blocks a held strike that is not on the chain", () => {
    const chain = chainFrom(
      draft("PLTR", 20, "2026-10-09", [
        { expiry: EXPIRY, right: "C", strike: 30, bid: 1, ask: 1.2, feedIv: 0.4, multiplier: 100, root: null },
      ]),
    );
    const lab = editLab(
      createLab(chain),
      { kind: "importHeld", expiry: isoDate(EXPIRY), label: "Held", legs: [{ right: "C", strike: 25, ratio: -1 }], netPerShare: -2, stock: null },
      chain,
    );
    const row = lab.structures[0];
    assert.equal(row?.legs.length, 0);
    assert.match(row?.resolveError ?? "", /Not listed/);
  });
});

describe("phase 3 vol shift", () => {
  // r = q = 0, S = K = 100, T = 1. d1 = 0.5 σ, d2 = -d1, call = 100 (2 N(d1) - 1).
  // σ = 0.20 → about 7.9656. σ = 0.30 → about 11.9237. +10 vol points and +50% of IV are the same shift.
  const hand20 = 7.96556746;
  const hand30 = 11.92368754;

  function labChain(): OptionChain {
    return chainFrom(
      draft("NOW", 100, "2026-01-01", [
        { expiry: "2028-01-01", right: "C", strike: 100, bid: 7.9, ask: 8.1, feedIv: 0.2, multiplier: 100, root: null },
        { expiry: "2028-01-01", right: "C", strike: 120, bid: 3, ask: 3.4, feedIv: 0.2, multiplier: 100, root: null },
      ]),
    );
  }

  function withShift(chain: OptionChain, amount: number, mode: "points" | "pct") {
    return editLab(
      createLab(chain),
      [
        { kind: "setAssumptions", patch: { rate: 0, dividendYield: 0, ivSource: "mid", volShift: { mode, amount } } },
        { kind: "setBasis", basis: { kind: "perPackage" } },
        { kind: "setHorizons", horizons: [{ kind: "entry" }, { kind: "date", date: isoDate("2027-01-01") }] },
        { kind: "addStructure", label: "Call", expiry: isoDate("2028-01-01"), request: { template: "longCall", strike: { by: "strike", strike: 100 } } },
        { kind: "setIvOverride", id: "s1", legIndex: 0, iv: 0.2 },
        { kind: "setEntry", id: "s1", entry: { kind: "limit", netPerShare: 8 } },
        {
          kind: "addStructure",
          label: "Other",
          expiry: isoDate("2028-01-01"),
          request: { template: "longCall", strike: { by: "strike", strike: 120 } },
        },
        { kind: "setIvOverride", id: "s2", legIndex: 0, iv: 0.35 },
        { kind: "setEntry", id: "s2", entry: { kind: "limit", netPerShare: 3.2 } },
      ],
      chain,
    );
  }

  it("reprices future dates only, and the shift is hand-checkable", () => {
    const chain = labChain();
    const base = evaluateLab(withShift(chain, 0, "points"), chain);
    const points = evaluateLab(withShift(chain, 10, "points"), chain);
    const pct = evaluateLab(withShift(chain, 50, "pct"), chain);
    const price20 = bsmPrice({ right: "C", spot: 100, strike: 100, years: 1, rate: 0, dividendYield: 0, vol: 0.2 });
    const price30 = bsmPrice({ right: "C", spot: 100, strike: 100, years: 1, rate: 0, dividendYield: 0, vol: 0.3 });
    // ATM, r = q = 0: call = S (2 N(σ/2) - 1). Published N(0.10) and N(0.15) sit within 0.0002 of this erf.
    assert.ok(Math.abs(price20 - 100 * (2 * normCdf(0.1) - 1)) < 1e-9);
    assert.ok(Math.abs(price30 - 100 * (2 * normCdf(0.15) - 1)) < 1e-9);
    assert.ok(Math.abs(price20 - hand20) < 2e-4);
    assert.ok(Math.abs(price30 - hand30) < 2e-4);
    assert.ok(Math.abs(applyVolShift(0.2, { mode: "points", amount: 10 }) - 0.3) < 1e-12);
    assert.ok(Math.abs(applyVolShift(0.2, { mode: "pct", amount: 50 }) - 0.3) < 1e-12);

    assert.equal(priced(base, "Call").debit, 800);
    assert.equal(priced(points, "Call").debit, 800);
    assert.equal(priced(base, "Call").legs[0]?.iv, 0.2);
    assert.equal(priced(points, "Call").legs[0]?.iv, 0.2);
    assert.equal(priced(points, "Call").spec.legs[0]?.ivOverride, 0.2);

    const entry = pnlOn(base, "2026-01-01", 100, "Call");
    assert.equal(pnlOn(points, "2026-01-01", 100, "Call"), entry);
    assert.equal(pnlOn(pct, "2026-01-01", 100, "Call"), entry);

    const futureBase = pnlOn(base, "2027-01-01", 100, "Call");
    const futurePoints = pnlOn(points, "2027-01-01", 100, "Call");
    const futurePct = pnlOn(pct, "2027-01-01", 100, "Call");
    assert.ok(Math.abs(futureBase - (price20 * 100 - 800)) < 1e-6);
    assert.ok(Math.abs(futurePoints - (price30 * 100 - 800)) < 1e-6);
    assert.ok(Math.abs(futurePoints - (hand30 * 100 - 800)) < 0.02);
    assert.equal(futurePct, futurePoints);
    assert.notEqual(futurePoints, futureBase);

    const expirySpots = (ev: ReturnType<typeof evaluateLab>) => ev.expiryBoards.flatMap((board) => board.crossovers.map((item) => item.spot));
    assert.deepEqual(expirySpots(points), expirySpots(base));
    assert.notDeepEqual(
      points.modelCrossovers.map((item) => item.spot),
      base.modelCrossovers.map((item) => item.spot),
    );

    const cube = evaluationCubeCsv(points);
    assert.equal(cube.split("\n")[0], "structure,horizon,date,spot,pnl");
    assert.ok(cube.includes(String(futurePoints)));
    const table = entryTableCsv(points);
    assert.match(table, /Call,2028-01-01,1C 100,limit 8,800,/);
    assert.equal(describeVolShift({ mode: "points", amount: 10 }), "IV shift applied · +10 vol points");
    assert.equal(describeVolShift({ mode: "pct", amount: -10 }), "IV shift applied · -10% of IV");
    assert.equal(describeVolShift({ mode: "points", amount: 0 }), null);
  });
});

describe("phase 3 snapshots", () => {
  it("saves through the scenario parser and keeps a stable id", () => {
    const chain = chainFrom(
      draft("NOW", 100, "2026-10-09", [
        { expiry: EXPIRY, right: "C", strike: 100, bid: 9, ask: 11, feedIv: 0.3, multiplier: 100, root: null },
      ]),
    );
    const lab = editLab(
      createLab(chain),
      [
        { kind: "setAssumptions", patch: { volShift: { mode: "points", amount: 5 } } },
        { kind: "addStructure", label: "Call", expiry: isoDate(EXPIRY), request: { template: "longCall", strike: { by: "strike", strike: 100 } } },
        { kind: "setStock", id: "s1", stock: { shares: 100, averagePrice: 100 } },
      ],
      chain,
    );
    const raw = JSON.parse(JSON.stringify(lab)) as { assumptions: { volShift?: unknown }; structures: { stock?: unknown }[] };
    delete raw.assumptions.volShift;
    delete raw.structures[0]?.stock;
    const legacy = parseScenario(raw);
    assert.equal(legacy?.assumptions.volShift.amount, 0);
    assert.equal(legacy?.structures[0]?.stock, null);
    const broken = JSON.parse(JSON.stringify(lab)) as { assumptions: { volShift: { mode: string } } };
    broken.assumptions.volShift.mode = "gap";
    assert.equal(parseScenario(broken), null);

    const schema = fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), "../../db/schema.sql"), "utf8");
    const db = new Database(":memory:");
    db.exec(schema);
    const saved = saveSnapshot(
      db,
      { scenario: { ...lab, extra: true }, quotes: compactQuotes(chain, lab), provenance: provenanceFromChain(chain), summary: "NOW call" },
      "2026-10-09T18:00:00.000Z",
    );
    assert.equal(saved.ok, true);
    if (!saved.ok) return;
    assert.match(saved.row.id, /^[0-9a-f-]{36}$/i);
    assert.equal(saved.row.symbol, "NOW");
    assert.equal(saved.row.summary, "NOW call");
    assert.equal(saved.row.provenance.source, "cboe");
    assert.equal(saved.row.provenance.delayed, true);
    assert.equal(saved.row.provenance.timestamp, "2026-10-09T15:00:00.000Z");
    assert.equal(saved.row.scenario.assumptions.volShift.amount, 5);
    assert.equal(saved.row.scenario.structures[0]?.stock?.shares, 100);
    assert.equal(saved.row.quotes.contracts[0]?.strike, 100);
    assert.equal((saved.row.scenario as { extra?: unknown }).extra, undefined);

    const again = getSnapshot(db, saved.row.id);
    assert.equal(again?.id, saved.row.id);
    assert.equal(again?.scenario.assumptions.volShift.amount, 5);
    assert.equal(listSnapshots(db, "NOW").length, 1);
    assert.equal(listSnapshots(db, "PLTR").length, 0);
    assert.equal(saveSnapshot(db, { scenario: { symbol: "nope" }, quotes: saved.row.quotes, provenance: saved.row.provenance }).ok, false);
    assert.equal(deleteSnapshot(db, saved.row.id).ok, true);
    assert.equal(getSnapshot(db, saved.row.id), null);
    db.close();
  });
});
