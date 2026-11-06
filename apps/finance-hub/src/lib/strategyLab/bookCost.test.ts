import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  assembleBook,
  bookUnderlyings,
  buildUnderlyingTree,
  nodeState,
  selectionCost,
  toggleUnderlyingLegs,
  type BookLeg,
  type BookPositionInput,
  type BookTxnInput,
} from "@/lib/strategyLab/bookCost";

function position(patch: Partial<BookPositionInput> & Pick<BookPositionInput, "id" | "quantity">): BookPositionInput {
  return {
    accountId: "schwab_joint",
    accountLabel: "Joint",
    symbol: "TSLA  270115C00250000",
    securityType: "option",
    underlyingSymbol: "TSLA",
    optionType: "CALL",
    expirationDate: "2027-01-15",
    strikePrice: 250,
    price: 15,
    marketValue: 1500,
    metadataJson: null,
    ...patch,
  };
}

function txn(patch: Partial<BookTxnInput>): BookTxnInput {
  return {
    accountId: "schwab_joint",
    tradeDate: "2026-09-01",
    symbol: "TSLA  270115C00250000",
    underlyingSymbol: "TSLA",
    assetType: "OPTION",
    instruction: "BUY_TO_OPEN",
    positionEffect: "OPENING",
    quantity: 4,
    price: 10,
    optionExpiration: "2027-01-15",
    optionRight: "C",
    optionStrike: 250,
    ...patch,
  };
}

describe("book cost reconstruction", () => {
  it("keeps the remaining lots after a partial close", () => {
    const legs = assembleBook(
      [position({ id: "p1", quantity: 3 })],
      [
        txn({}),
        txn({ tradeDate: "2026-09-15", quantity: 2, price: 14 }),
        txn({ tradeDate: "2026-10-01", instruction: "SELL_TO_CLOSE", positionEffect: "CLOSING", quantity: 3, price: 16 }),
      ],
    );
    assert.equal(legs.length, 1);
    const leg = legs[0]!;
    assert.equal(leg.costSource, "transactions");
    assert.ok(Math.abs((leg.bookPrice ?? 0) - (10 + 28) / 3) < 1e-9);
    assert.equal(leg.bookDate, "2026-09-01");
    assert.equal(leg.fillCount, 2);
    assert.equal(leg.missingCost, false);
    assert.equal(leg.partial, false);
  });

  it("uses the position average when the ledger is short, and flags a leg with neither", () => {
    const partial = assembleBook(
      [position({ id: "p1", quantity: 10, metadataJson: JSON.stringify({ averagePrice: 8, purchaseDate: "2026-08-01" }) })],
      [txn({ quantity: 3, price: 9 })],
    )[0]!;
    assert.equal(partial.costSource, "position");
    assert.equal(partial.bookPrice, 8);
    assert.equal(partial.bookDate, "2026-09-01");
    assert.equal(partial.partial, true);
    assert.equal(partial.missingCost, false);

    const missing = assembleBook([position({ id: "p2", quantity: 1, price: 15, marketValue: 1500 })], [])[0]!;
    assert.equal(missing.missingCost, true);
    assert.equal(missing.bookPrice, null);
    assert.equal(missing.mark, 15);
  });

  it("prices a short from the opening sale", () => {
    const leg = assembleBook(
      [position({ id: "s", quantity: -3, symbol: "TSLA  270115P00200000", optionType: "PUT", strikePrice: 200, marketValue: -600 })],
      [
        txn({
          instruction: "SELL_TO_OPEN",
          quantity: 3,
          price: 2,
          symbol: "TSLA  270115P00200000",
          optionRight: "P",
          optionStrike: 200,
        }),
      ],
    )[0]!;
    assert.equal(leg.instrument, "put");
    assert.equal(leg.bookPrice, 2);
    assert.equal(selectionCost([leg], new Set([leg.id])).net, -600);
  });
});

describe("book checkbox tree", () => {
  const aapl: BookLeg = {
    id: "c1",
    accountId: "joint",
    accountLabel: "Joint",
    underlying: "AAPL",
    instrument: "stock",
    expiry: null,
    right: null,
    strike: null,
    quantity: 10,
    bookPrice: 180,
    bookDate: "2026-09-04",
    mark: 190,
    costSource: "transactions",
    dateSource: "transactions",
    fillCount: 1,
    partial: false,
    missingCost: false,
  };
  const legs: BookLeg[] = [
    {
      id: "a1",
      accountId: "joint",
      accountLabel: "Joint",
      underlying: "TSLA",
      instrument: "call",
      expiry: "2027-01-15",
      right: "C",
      strike: 250,
      quantity: 1,
      bookPrice: 10,
      bookDate: "2026-09-01",
      mark: 15,
      costSource: "transactions",
      dateSource: "transactions",
      fillCount: 1,
      partial: false,
      missingCost: false,
    },
    {
      id: "a2",
      accountId: "joint",
      accountLabel: "Joint",
      underlying: "TSLA",
      instrument: "call",
      expiry: "2027-06-17",
      right: "C",
      strike: 300,
      quantity: 2,
      bookPrice: 8,
      bookDate: "2026-09-02",
      mark: 9,
      costSource: "position",
      dateSource: "missing",
      fillCount: 0,
      partial: false,
      missingCost: false,
    },
    {
      id: "b1",
      accountId: "ira",
      accountLabel: "IRA",
      underlying: "TSLA",
      instrument: "put",
      expiry: "2027-01-15",
      right: "P",
      strike: 200,
      quantity: -1,
      bookPrice: 4,
      bookDate: "2026-09-03",
      mark: 5,
      costSource: "transactions",
      dateSource: "transactions",
      fillCount: 1,
      partial: false,
      missingCost: false,
    },
  ];

  it("checks a parent, shows a partial selection, and clears inside one underlying", () => {
    const all = [...legs, aapl];
    const rows = bookUnderlyings(all);
    assert.deepEqual(
      rows.map((row) => row.symbol),
      ["TSLA", "AAPL"],
    );
    assert.equal(rows[0]?.legCount, 3);
    assert.equal(rows[0]?.shareEquivalent, 400);
    assert.deepEqual(rows[0]?.accounts, ["IRA", "Joint"]);
    assert.equal(rows[1]?.legCount, 1);
    assert.deepEqual(rows[1]?.accounts, ["Joint"]);

    const tree = buildUnderlyingTree(all, "TSLA");
    assert.equal(tree.label, "All accounts");
    assert.deepEqual(tree.legIds, ["b1", "a1", "a2"]);
    assert.equal(tree.legIds.includes("c1"), false);
    const joint = tree.children.find((node) => node.label === "Joint")!;
    assert.equal(joint.kind, "account");
    assert.ok(joint.children.every((child) => child.kind === "expiry"));
    assert.deepEqual(joint.legIds, ["a1", "a2"]);
    let selected = toggleUnderlyingLegs(all, new Set(), joint.legIds);
    assert.equal(nodeState(tree.legIds, selected), "mixed");
    assert.equal(nodeState(joint.legIds, selected), "on");
    selected = toggleUnderlyingLegs(all, selected, ["a1"]);
    assert.equal(nodeState(joint.legIds, selected), "mixed");
    selected = toggleUnderlyingLegs(all, selected, tree.legIds);
    assert.equal(nodeState(tree.legIds, selected), "on");
    assert.equal(selectionCost(legs, selected).count, 3);
    assert.equal(selectionCost(legs, selected).net, 10 * 100 + 8 * 2 * 100 + -1 * 4 * 100);
    selected = toggleUnderlyingLegs(all, selected, tree.legIds);
    assert.equal(nodeState(tree.legIds, selected), "off");
    assert.equal(selectionCost(legs, selected).count, 0);
  });

  it("makes a mixed-underlying selection impossible", () => {
    const all = [...legs, aapl];
    const tsla = buildUnderlyingTree(all, "TSLA");
    const selected = toggleUnderlyingLegs(all, new Set(), tsla.legIds);
    const refused = toggleUnderlyingLegs(all, selected, ["c1"]);
    assert.deepEqual([...refused].sort(), [...selected].sort());
    const symbols = new Set(all.filter((leg) => refused.has(leg.id)).map((leg) => leg.underlying));
    assert.equal(symbols.size, 1);
    assert.equal(symbols.has("AAPL"), false);
    const both = toggleUnderlyingLegs(all, new Set(), ["a1", "c1"]);
    assert.equal(both.size, 0);
    const onlyAapl = buildUnderlyingTree(all, "AAPL");
    assert.deepEqual(onlyAapl.legIds, ["c1"]);
    assert.equal(onlyAapl.legIds.includes("a1"), false);
  });
});
