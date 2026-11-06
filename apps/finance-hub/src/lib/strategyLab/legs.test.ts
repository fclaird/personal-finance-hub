import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { bsmPrice } from "@/lib/options/blackScholes";
import { calendarDaysBetween, isoDate, makeOptionChain, type DraftContract } from "@/lib/optionChain/chain";
import { markAt } from "@/lib/strategyLab/internal/pricing";
import { createLab, editLab, evaluateLab } from "@/lib/strategyLab/lab";
import { parseScenario, readLibrary, SCENARIO_STORAGE_KEY_V1 } from "@/lib/strategyLab/scenarioStore";
import { MODEL_DIVIDEND_YIELD, MODEL_RATE } from "@/lib/strategyLab/modelAssumptions";

describe("leg migration", () => {
  it("turns a v1 call spread and a share sidecar into legs", () => {
    const chain = makeOptionChain({
      symbol: "NOW",
      spot: 100,
      tradeDate: "2026-10-08",
      quoteTime: null,
      source: "cboe",
      delayed: true,
      dividendYieldHint: 0,
      contracts: [
        { expiry: "2027-01-15", right: "C", strike: 100, bid: 5, ask: 6, feedIv: null, multiplier: 100, root: null },
      ],
      fetchedAt: "2026-10-08T16:00:00.000Z",
      servedFrom: "network",
      fallbackFrom: null,
    });
    assert.equal(chain.ok, true);
    if (!chain.ok) return;
    const live = editLab(
      createLab(chain.chain),
      {
        kind: "addStructure",
        label: "Call",
        expiry: isoDate("2027-01-15"),
        request: { template: "longCall", strike: { by: "strike", strike: 100 } },
      },
      chain.chain,
    );
    const v1 = JSON.parse(JSON.stringify(live)) as {
      structures: Array<{ legs: unknown[]; stock?: { shares: number; averagePrice: number } }>;
    };
    const first = v1.structures[0]!;
    first.legs = [{ right: "C", strike: 100, ratio: 2, ivOverride: 0.2 }];
    first.stock = { shares: 100, averagePrice: 90 };
    const parsed = parseScenario(v1);
    assert.ok(parsed);
    const legs = parsed?.structures[0]?.legs ?? [];
    assert.equal(legs[0]?.instrument, "call");
    assert.equal(legs[0]?.side, "long");
    assert.equal(legs[0]?.quantity, 2);
    assert.equal(legs[0]?.ivOverride, 0.2);
    assert.equal(legs[1]?.instrument, "stock");
    assert.equal(legs[1]?.side, "long");
    assert.equal(legs[1]?.quantity, 100);
    assert.equal(legs[1]?.entry.price, 90);
    assert.equal("stock" in (parsed?.structures[0] ?? {}), false);
  });

  it("reads a v1 library when v2 is absent", () => {
    const chain = makeOptionChain({
      symbol: "NOW",
      spot: 100,
      tradeDate: "2026-10-08",
      quoteTime: null,
      source: "cboe",
      delayed: true,
      dividendYieldHint: 0,
      contracts: [
        { expiry: "2027-01-15", right: "P", strike: 90, bid: 2, ask: 3, feedIv: null, multiplier: 100, root: null },
      ],
      fetchedAt: "2026-10-08T16:00:00.000Z",
      servedFrom: "network",
      fallbackFrom: null,
    });
    assert.equal(chain.ok, true);
    if (!chain.ok) return;
    const live = editLab(
      createLab(chain.chain),
      {
        kind: "addStructure",
        label: "Put",
        expiry: isoDate("2027-01-15"),
        request: { template: "custom", legs: [{ right: "P", strike: 90, ratio: -1 }] },
      },
      chain.chain,
    );
    const scenario = JSON.parse(JSON.stringify(live)) as { structures: Array<{ legs: unknown[] }> };
    scenario.structures[0]!.legs = [{ right: "P", strike: 90, ratio: -1, ivOverride: null }];
    const mem = new Map<string, string>();
    mem.set(
      SCENARIO_STORAGE_KEY_V1,
      JSON.stringify({ v: 1, scenarios: [{ name: "Old", savedAt: "2026-10-09T15:00:00.000Z", scenario }] }),
    );
    const storage = { getItem: (key: string) => mem.get(key) ?? null, setItem: (key: string, value: string) => void mem.set(key, value) };
    const loaded = readLibrary(storage);
    assert.equal(loaded[0]?.scenario.structures[0]?.legs[0]?.instrument, "put");
    assert.equal(loaded[0]?.scenario.structures[0]?.legs[0]?.side, "short");
  });
});

describe("per-expiry marks", () => {
  it("settles the near leg and keeps the far leg on the model", () => {
    const near = "2026-11-20";
    const far = "2027-06-18";
    const contracts: DraftContract[] = [
      { expiry: near, right: "C", strike: 100, bid: 4, ask: 5, feedIv: null, multiplier: 100, root: null },
      { expiry: far, right: "C", strike: 100, bid: 12, ask: 14, feedIv: null, multiplier: 100, root: null },
    ];
    const built = makeOptionChain({
      symbol: "NOW",
      spot: 100,
      tradeDate: "2026-10-08",
      quoteTime: null,
      source: "cboe",
      delayed: true,
      dividendYieldHint: 0,
      contracts,
      fetchedAt: "2026-10-08T16:00:00.000Z",
      servedFrom: "network",
      fallbackFrom: null,
    });
    assert.equal(built.ok, true);
    if (!built.ok) return;
    const started = editLab(
      createLab(built.chain),
      {
        kind: "addStructure",
        label: "Calendar",
        expiry: isoDate(far),
        request: {
          template: "custom",
          legs: [
            { right: "C", strike: 100, ratio: -1 },
            { right: "C", strike: 100, ratio: 1 },
          ],
        },
      },
      built.chain,
    );
    const spec = started.structures[0]!;
    const lab = {
      ...started,
      structures: [
        {
          ...spec,
          expiry: isoDate(far),
          legs: [
            { ...spec.legs[0]!, expiry: isoDate(near) },
            { ...spec.legs[1]!, expiry: isoDate(far) },
          ],
        },
      ],
    };
    const ev = evaluateLab(lab, built.chain);
    const row = ev.structures[0];
    assert.ok(row && row.status === "priced");
    if (!row || row.status !== "priced") return;
    const between = isoDate("2027-01-15");
    const assumptions = { rate: MODEL_RATE, dividendYield: MODEL_DIVIDEND_YIELD, ivSource: "mid" as const };
    const mark = markAt(built.chain, row.spec.expiry, row.legs, assumptions, 110, between);
    const nearIntrinsic = Math.max(110 - 100, 0) * -1 * 100;
    const farLeg = row.legs[1]!;
    assert.ok(farLeg.iv != null);
    const farYears = calendarDaysBetween(between, isoDate(far)) / 365;
    const farModel =
      bsmPrice({
        right: "C",
        spot: 110,
        strike: 100,
        years: farYears,
        rate: MODEL_RATE,
        dividendYield: MODEL_DIVIDEND_YIELD,
        vol: farLeg.iv!,
      }) * 100;
    assert.ok(mark != null);
    assert.ok(Math.abs((mark ?? 0) - (nearIntrinsic + farModel)) < 1e-6);
  });
});
