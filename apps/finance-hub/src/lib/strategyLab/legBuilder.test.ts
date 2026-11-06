import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isoDate, makeOptionChain, type ChainDraft, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { createLab, editLab } from "@/lib/strategyLab/lab";

const NEAR = "2027-01-15";
const FAR = "2027-06-18";

function draft(contracts: DraftContract[]): ChainDraft {
  return {
    symbol: "NOW",
    spot: 140,
    tradeDate: "2026-10-08",
    quoteTime: null,
    source: "cboe",
    delayed: true,
    dividendYieldHint: 0,
    contracts,
    fetchedAt: "2026-10-08T16:00:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
  };
}

function contract(expiry: string, right: "C" | "P", strike: number): DraftContract {
  return { expiry, right, strike, bid: 2, ask: 2.4, feedIv: null, multiplier: 100, root: null };
}

function chainOf(): OptionChain {
  const built = makeOptionChain(
    draft([
      contract(NEAR, "C", 130),
      contract(NEAR, "C", 140),
      contract(NEAR, "C", 150),
      contract(NEAR, "P", 120),
      contract(NEAR, "P", 140),
      contract(FAR, "C", 140),
      contract(FAR, "P", 140),
    ]),
  );
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

describe("free-form leg builder", () => {
  const chain = chainOf();

  it("keeps a template tracked until the first manual leg edit", () => {
    const started = editLab(createLab(chain), {
      kind: "addStructure",
      label: "Long call",
      expiry: isoDate(NEAR),
      request: { template: "longCall", strike: { by: "strike", strike: 140 } },
    }, chain);
    const spec = started.structures[0]!;
    assert.equal(spec.origin?.tracking, true);
    assert.equal(spec.legs[0]!.instrument, "call");
    assert.equal(spec.legs[0]!.side, "long");
    const edited = editLab(started, { kind: "setLeg", id: spec.id, legIndex: 0, side: "short" }, chain);
    const leg = edited.structures[0]!.legs[0]!;
    assert.equal(edited.structures[0]!.origin?.tracking, false);
    assert.equal(leg.side, "short");
    assert.equal(leg.instrument, "call");
    assert.equal(leg.ratio, -1);
    assert.equal(leg.quantity, 1);
  });

  it("adds a put from the chain grid and a blank long call", () => {
    const started = editLab(createLab(chain), {
      kind: "addStructure",
      label: "Custom",
      expiry: isoDate(NEAR),
      request: { template: "custom", legs: [{ right: "P", strike: 120, ratio: -1 }] },
    }, chain);
    const id = started.structures[0]!.id;
    assert.equal(started.structures[0]!.legs[0]!.instrument, "put");
    assert.equal(started.structures[0]!.legs[0]!.side, "short");
    const added = editLab(started, { kind: "addLeg", id, right: "P", strike: 140, ratio: 1 }, chain);
    assert.equal(added.structures[0]!.legs[1]!.instrument, "put");
    assert.equal(added.structures[0]!.legs[1]!.side, "long");
    const blank = editLab(added, { kind: "addBlankLeg", id }, chain);
    const extra = blank.structures[0]!.legs[2]!;
    assert.equal(extra.instrument, "call");
    assert.equal(extra.side, "long");
    assert.equal(extra.quantity, 1);
    assert.equal(extra.strike, 140);
    assert.equal(extra.entry.kind, "mid");
    assert.equal(blank.structures[0]!.origin?.tracking, false);
  });

  it("changes quantity, expiry, and instrument, including stock", () => {
    const started = editLab(createLab(chain), {
      kind: "addStructure",
      label: "Custom",
      expiry: isoDate(NEAR),
      request: { template: "custom", legs: [{ right: "C", strike: 140, ratio: 1 }] },
    }, chain);
    const id = started.structures[0]!.id;
    const qty = editLab(started, { kind: "setLeg", id, legIndex: 0, quantity: 3 }, chain);
    assert.equal(qty.structures[0]!.legs[0]!.quantity, 3);
    assert.equal(qty.structures[0]!.legs[0]!.ratio, 3);
    const dated = editLab(qty, { kind: "setLeg", id, legIndex: 0, expiry: isoDate(FAR) }, chain);
    assert.equal(dated.structures[0]!.legs[0]!.expiry, FAR);
    const put = editLab(dated, { kind: "setLeg", id, legIndex: 0, instrument: "put" }, chain);
    assert.equal(put.structures[0]!.legs[0]!.instrument, "put");
    assert.equal(put.structures[0]!.legs[0]!.right, "P");
    assert.equal(put.structures[0]!.legs[0]!.strike, 140);
    const stock = editLab(put, { kind: "setLeg", id, legIndex: 0, instrument: "stock", quantity: 100, side: "long" }, chain);
    const shares = stock.structures[0]!.legs[0]!;
    assert.equal(shares.instrument, "stock");
    assert.equal(shares.quantity, 100);
    assert.equal(shares.ratio, 100);
    assert.equal(shares.strike, null);
    assert.equal(shares.entry.kind, "limit");
    assert.equal(shares.entry.price, 140);
    const rejected = editLab(stock, { kind: "setLeg", id, legIndex: 0, instrument: "call", quantity: 0 }, chain);
    assert.equal(rejected.structures[0]!.legs[0]!.instrument, "stock");
  });

  it("stops at eight legs and removes the structure when the last leg drops", () => {
    let lab = editLab(createLab(chain), {
      kind: "addStructure",
      label: "Custom",
      expiry: isoDate(NEAR),
      request: { template: "custom", legs: [{ right: "C", strike: 140, ratio: 1 }] },
    }, chain);
    const id = lab.structures[0]!.id;
    for (let n = 0; n < 10; n++) lab = editLab(lab, { kind: "addBlankLeg", id }, chain);
    assert.equal(lab.structures[0]!.legs.length, 8);
    for (let n = 0; n < 7; n++) lab = editLab(lab, { kind: "removeLeg", id, legIndex: 0 }, chain);
    assert.equal(lab.structures[0]!.legs.length, 1);
    lab = editLab(lab, { kind: "removeLeg", id, legIndex: 0 }, chain);
    assert.equal(lab.structures.length, 0);
  });
});
