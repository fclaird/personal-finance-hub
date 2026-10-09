import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isoDate, makeOptionChain, type ChainDraft, type DraftContract } from "@/lib/optionChain/chain";
import { createLab, editLab, evaluateLab } from "@/lib/strategyLab/lab";
import {
  deltaHighlights,
  formatModelDelta,
  modelStrikeDelta,
  nearestDeltaStrike,
  strikeChoiceLabel,
  strikeDeltas,
  structureDeltaSummary,
} from "@/lib/strategyLab/strikeDelta";

const JAN = "2029-01-19";
const ASSUMPTIONS = { rate: 0.04, dividendYield: 0 };

function draft(partial: Omit<ChainDraft, "quoteTime" | "fetchedAt" | "servedFrom" | "fallbackFrom" | "delayed">): ChainDraft {
  return {
    quoteTime: null,
    fetchedAt: "2026-10-08T16:13:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
    delayed: true,
    ...partial,
  };
}

function contracts(expiry: string, right: "C" | "P", rows: readonly (readonly [number, number, number])[]): DraftContract[] {
  return rows.map(([strike, bid, ask]) => ({
    expiry,
    right,
    strike,
    bid,
    ask,
    feedIv: null,
    multiplier: 100,
    root: null,
  }));
}

function janChain(extra: DraftContract[] = []) {
  const built = makeOptionChain(
    draft({
      symbol: "NOW",
      spot: 136.58,
      tradeDate: "2026-10-08",
      source: "cboe",
      dividendYieldHint: 0,
      contracts: [
        ...contracts(JAN, "C", [
          [120, 53.85, 59.25],
          [150, 43.4, 44.7],
          [160, 39.75, 41.75],
          [210, 27.75, 29.05],
        ]),
        ...extra,
      ],
    }),
  );
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

describe("model strike delta", () => {
  const chain = janChain();

  it("puts the NOW Jan 2029 120 and 210 call deltas near .78 and .51", () => {
    const d120 = modelStrikeDelta(chain, isoDate(JAN), "C", 120, ASSUMPTIONS);
    const d210 = modelStrikeDelta(chain, isoDate(JAN), "C", 210, ASSUMPTIONS);
    assert.ok(d120 != null && d210 != null);
    assert.ok(Math.abs(d120 - 0.78) <= 0.03, `120 call ${d120}`);
    assert.ok(Math.abs(d210 - 0.51) <= 0.04, `210 call ${d210}`);
    assert.equal(formatModelDelta(d120), d120.toFixed(2).replace(/^0/, ""));
    assert.match(strikeChoiceLabel(120, d120, "75"), /^120 {2}\(Δ \.\d\d\) {2}· \.75$/);
  });

  it("highlights the strikes nearest .75 and .50 and snaps a 75/50 zebra onto them", () => {
    const rows = strikeDeltas(chain, isoDate(JAN), "C", ASSUMPTIONS);
    const marks = deltaHighlights(rows);
    assert.equal(marks.seventyFive, 120);
    assert.equal(marks.fifty, 210);
    assert.equal(nearestDeltaStrike(rows, 0.75, "lower"), 120);
    assert.equal(nearestDeltaStrike(rows, 0.5, "higher"), 210);
  });

  it("moves when the dividend yield changes and keeps put delta negative", () => {
    const flat = modelStrikeDelta(chain, isoDate(JAN), "C", 120, ASSUMPTIONS);
    const yielded = modelStrikeDelta(chain, isoDate(JAN), "C", 120, { rate: 0.04, dividendYield: 0.02 });
    assert.ok(flat != null && yielded != null);
    assert.notEqual(flat, yielded);
    const withPut = janChain(contracts(JAN, "P", [[160, 28, 32]]));
    const put = modelStrikeDelta(withPut, isoDate(JAN), "P", 160, ASSUMPTIONS);
    const call = modelStrikeDelta(withPut, isoDate(JAN), "C", 160, ASSUMPTIONS);
    assert.ok(put != null && call != null);
    assert.ok(put < 0);
    assert.ok(call > 0);
  });

  it("reports the zebra net delta and long/short ratio from the same mid model", () => {
    const lab = editLab(
      createLab(chain),
      {
        kind: "addStructure",
        label: "C",
        expiry: isoDate(JAN),
        request: { template: "zebra", long: { by: "strike", strike: 120 }, short: { by: "strike", strike: 210 } },
        entry: { kind: "limit", netPerShare: 84.7 },
      },
      chain,
    );
    const ev = evaluateLab(lab, chain);
    const row = ev.structures.find((item) => item.spec.label === "C");
    assert.ok(row && row.status === "priced" && row.greeks);
    const summary = structureDeltaSummary(row.legs, (right, strike) => modelStrikeDelta(chain, isoDate(JAN), right, strike, ASSUMPTIONS));
    assert.ok(summary.net != null && summary.ratio != null);
    assert.ok(Math.abs(summary.net - row.greeks.delta) < 0.05);
    assert.ok(summary.ratio > 2 && summary.ratio < 4);
    assert.equal(summary.legs[0]?.strike, 120);
    assert.equal(summary.legs[1]?.strike, 210);
  });
});
