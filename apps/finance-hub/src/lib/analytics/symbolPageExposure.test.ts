import assert from "node:assert/strict";
import test from "node:test";

import type { Row } from "@/app/components/PositionsGroupedTable";

import { computeSymbolPageExposure, symbolPageEquityRowMark } from "./symbolPageExposure";

function stockRow(qty: number, price: number, marketValue: number): Row {
  return {
    positionId: "s1",
    accountName: "Acct",
    symbol: "RKLB",
    quantity: qty,
    price,
    marketValue,
    securityType: "equity",
    effectiveUnderlyingSymbol: "RKLB",
  } as Row;
}

function callRow(qty: number, delta: number): Row {
  return {
    positionId: "c1",
    accountName: "Acct",
    symbol: "RKLB 21 Jan 28 C 40",
    quantity: qty,
    price: 110.93,
    marketValue: qty * 110.93 * 100,
    securityType: "option",
    delta,
    effectiveUnderlyingSymbol: "RKLB",
  } as Row;
}

test("computeSymbolPageExposure uses live quote for spot and synthetic ahead of stale snapshots", () => {
  const positions = [stockRow(6100, 35.5, 216537.23), callRow(31, 1)];
  const exposure = computeSymbolPageExposure(positions, {
    mark: null,
    last: 143.64,
    close: 35.5,
  });

  assert.equal(exposure.heldShares, 6100);
  assert.ok(Math.abs(exposure.synthShares - 3100) < 1e-3);
  assert.ok(Math.abs(exposure.spotMv - 6100 * 143.64) < 0.01);
  assert.ok(Math.abs(exposure.synthMv - 3100 * 143.64) < 0.01);
  assert.ok(Math.abs(exposure.netMv - (exposure.spotMv + exposure.synthMv)) < 0.01);
});

test("computeSymbolPageExposure falls back to snapshot implied price when no live quote", () => {
  const positions = [stockRow(6100, 35.4979, 216537.23), callRow(10, 0.5)];
  const exposure = computeSymbolPageExposure(positions, { mark: null, last: null, close: null });

  const implied = 216537.23 / 6100;
  assert.ok(Math.abs(exposure.spotMv - 216537.23) < 0.01);
  assert.ok(Math.abs(exposure.synthMv - 500 * implied) < 0.01);
});

test("symbolPageEquityRowMark overlays live quote on stock rows only", () => {
  const row = stockRow(6100, 35.5, 216537.23);
  const mark = symbolPageEquityRowMark(row, { mark: null, last: 143.64, close: 35.5 });
  assert.ok(Math.abs(mark.price! - 143.64) < 1e-6);
  assert.ok(Math.abs(mark.marketValue! - 6100 * 143.64) < 0.01);

  const opt = symbolPageEquityRowMark(callRow(1, 1), { mark: null, last: 143.64, close: 35.5 });
  assert.equal(opt.price, 110.93);
});
