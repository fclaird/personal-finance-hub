import assert from "node:assert/strict";
import test from "node:test";

import { resolveMarketsSlotInstrumentId } from "@/lib/market/glanceMarketsTileResolve";

test("resolveMarketsSlotInstrumentId maps equity defaults to e-mini outside RTH", () => {
  const overnight = new Date("2026-05-22T02:00:00.000Z"); // 22:00 ET May 21
  assert.equal(resolveMarketsSlotInstrumentId(2, "nasdaq", overnight), "us-nq");
  assert.equal(resolveMarketsSlotInstrumentId(3, "sp500", overnight), "us-es");
});

test("resolveMarketsSlotInstrumentId keeps user e-mini choice outside RTH", () => {
  const overnight = new Date("2026-05-22T02:00:00.000Z");
  assert.equal(resolveMarketsSlotInstrumentId(2, "us-nq", overnight), "us-nq");
  assert.equal(resolveMarketsSlotInstrumentId(3, "us-es", overnight), "us-es");
});

test("resolveMarketsSlotInstrumentId keeps equity symbols during RTH", () => {
  const rth = new Date("2026-05-22T15:00:00.000Z"); // 11:00 ET
  assert.equal(resolveMarketsSlotInstrumentId(2, "nasdaq", rth), "nasdaq");
  assert.equal(resolveMarketsSlotInstrumentId(3, "sp500", rth), "sp500");
});
