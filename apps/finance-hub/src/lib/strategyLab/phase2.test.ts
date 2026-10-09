import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { isoDate, makeOptionChain, type ChainDraft, type DraftContract, type OptionChain } from "@/lib/optionChain/chain";
import { parseCboeChain } from "@/lib/optionChain/internal/cboeWire";
import { parseSchwabChain } from "@/lib/optionChain/internal/schwabWire";
import { csvField, entryTableCsv, evaluationCubeCsv } from "@/lib/strategyLab/exportCsv";
import { createLab, editLab, evaluateLab, expiryPnlAtSpot, type PricedStructure } from "@/lib/strategyLab/lab";
import {
  parseLibrary,
  parseScenario,
  readLibrary,
  SCENARIO_STORAGE_KEY,
  upsertScenario,
  writeLibrary,
} from "@/lib/strategyLab/scenarioStore";

const EXPIRY = "2027-01-15";

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

function contract(right: "C" | "P", strike: number, bid: number, ask: number, openInterest?: number, volume?: number): DraftContract {
  return { expiry: EXPIRY, right, strike, bid, ask, feedIv: null, multiplier: 100, root: null, openInterest, volume };
}

function chainOf(): OptionChain {
  const built = makeOptionChain(
    draft([
      contract("C", 140, 19, 21),
      contract("P", 140, 14, 16),
      contract("P", 120, 2, 2.4, 15, 0),
      contract("C", 160, 3, 3.4, 8, 4),
    ]),
  );
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

function priced(label: string, ev: ReturnType<typeof evaluateLab>): PricedStructure {
  const row = ev.structures.find((item) => item.spec.label === label);
  assert.ok(row && row.status === "priced");
  if (!row || row.status !== "priced") throw new Error("unreachable");
  return row;
}

describe("phase 2 templates", () => {
  const chain = chainOf();
  const lab = editLab(createLab(chain), [
    { kind: "setAssumptions", patch: { rate: 0.04, dividendYield: 0, ivSource: "mid" } },
    { kind: "setBasis", basis: { kind: "equalCapital", capital: 10_000, units: "whole" } },
    {
      kind: "addStructure",
      label: "Synthetic",
      expiry: isoDate(EXPIRY),
      request: { template: "syntheticLong", strike: { by: "strike", strike: 140 } },
    },
    {
      kind: "addStructure",
      label: "Strangle",
      expiry: isoDate(EXPIRY),
      request: {
        template: "shortStrangle",
        put: { by: "strike", strike: 120 },
        call: { by: "strike", strike: 160 },
      },
    },
  ], chain);

  it("builds a same-strike synthetic and a short strangle", () => {
    const synthetic = lab.structures.find((item) => item.label === "Synthetic");
    const strangle = lab.structures.find((item) => item.label === "Strangle");
    assert.deepEqual(
      synthetic?.legs.map((leg) => [leg.right, leg.strike, leg.ratio]),
      [
        ["C", 140, 1],
        ["P", 140, -1],
      ],
    );
    assert.deepEqual(
      strangle?.legs.map((leg) => [leg.right, leg.strike, leg.ratio]),
      [
        ["P", 120, -1],
        ["C", 160, -1],
      ],
    );
  });

  it("sizes the synthetic from the loss at spot 0 and waits on the strangle", () => {
    const ev = evaluateLab(lab, chain);
    const synthetic = priced("Synthetic", ev);
    const strangle = priced("Strangle", ev);
    assert.equal(synthetic.debit, 500);
    assert.equal(expiryPnlAtSpot(synthetic.legs, synthetic.debit, 0), -14_500);
    assert.equal(synthetic.risk.maxLoss, 14_500);
    assert.equal(synthetic.sizing.status, "sized");
    if (synthetic.sizing.status === "sized") assert.equal(synthetic.sizing.packages, 0);
    assert.equal(strangle.risk.maxLoss, "unbounded");
    assert.equal(strangle.sizing.status, "needsCapitalOverride");
    assert.ok(ev.issues.some((issue) => issue.code === "needs-capital" && issue.structureId === strangle.spec.id));
  });

  it("uses a typed dollars-at-risk number and does not invent margin", () => {
    const overridden = editLab(lab, [
      { kind: "setCapitalOverride", id: lab.structures[0]!.id, dollars: 2000 },
      { kind: "setCapitalOverride", id: lab.structures[1]!.id, dollars: 2500 },
    ], chain);
    const ev = evaluateLab(overridden, chain);
    const synthetic = priced("Synthetic", ev);
    const strangle = priced("Strangle", ev);
    assert.equal(synthetic.sizing.status, "sized");
    assert.equal(strangle.sizing.status, "sized");
    if (synthetic.sizing.status === "sized") assert.equal(synthetic.sizing.packages, 5);
    if (strangle.sizing.status === "sized") {
      assert.equal(strangle.sizing.packages, 4);
      assert.equal(strangle.sizing.idleCash, 0);
    }
    assert.equal(editLab(lab, { kind: "setCapitalOverride", id: lab.structures[1]!.id, dollars: -10 }, chain).structures[1]!.capitalOverride, null);
  });

  it("adds and drops custom legs without an order", () => {
    const started = editLab(createLab(chain), {
      kind: "addStructure",
      label: "Custom",
      expiry: isoDate(EXPIRY),
      request: { template: "custom", legs: [{ right: "C", strike: 140, ratio: 1 }] },
    }, chain);
    const added = editLab(started, { kind: "addLeg", id: started.structures[0]!.id, right: "P", strike: 120, ratio: -1 }, chain);
    assert.equal(added.structures[0]!.legs.length, 2);
    assert.equal(added.structures[0]!.origin?.tracking, false);
    const dropped = editLab(added, { kind: "removeLeg", id: added.structures[0]!.id, legIndex: 1 }, chain);
    assert.equal(dropped.structures[0]!.legs.length, 1);
    const gone = editLab(dropped, { kind: "removeLeg", id: dropped.structures[0]!.id, legIndex: 0 }, chain);
    assert.equal(gone.structures.length, 0);
  });
});

describe("phase 2 save and restore", () => {
  const chain = chainOf();
  const lab = editLab(createLab(chain), {
    kind: "addStructure",
    label: "Synthetic",
    expiry: isoDate(EXPIRY),
    request: { template: "syntheticLong", strike: { by: "strike", strike: 140 } },
  }, chain);

  it("round-trips a real lab and drops fields it does not know", () => {
    const blob = JSON.parse(JSON.stringify({ ...lab, extra: "nope" })) as unknown;
    const parsed = parseScenario(blob);
    assert.ok(parsed);
    assert.equal(parsed?.symbol, "NOW");
    assert.equal((parsed as { extra?: string } | null)?.extra, undefined);
    assert.deepEqual(parsed?.structures[0]?.legs, lab.structures[0]?.legs);
    assert.equal(parsed?.structures[0]?.origin?.request.template, "syntheticLong");
    const again = parseScenario(JSON.parse(JSON.stringify(parsed)));
    assert.deepEqual(again, parsed);
  });

  it("rejects garbage, a bad horizon, and negative capital", () => {
    assert.equal(parseScenario("nope"), null);
    assert.equal(parseScenario(null), null);
    const negative = JSON.parse(JSON.stringify(lab)) as { basis: { capital: number } };
    negative.basis.capital = -1;
    assert.equal(parseScenario(negative), null);
    const moon = JSON.parse(JSON.stringify(lab)) as { horizons: unknown[] };
    moon.horizons = [{ kind: "moon" }];
    assert.equal(parseScenario(moon), null);
    assert.deepEqual(parseLibrary("nope"), []);
    assert.deepEqual(parseLibrary({ v: 1, scenarios: "bad" }), []);
  });

  it("keeps named saves and ignores a bad blob in the library", () => {
    const parsed = parseScenario(JSON.parse(JSON.stringify(lab)));
    assert.ok(parsed);
    if (!parsed) return;
    const saved = upsertScenario([], "Desk", parsed, "2026-10-09T15:00:00.000Z");
    assert.ok(saved);
    const replaced = upsertScenario(saved ?? [], "Desk", parsed, "2026-10-09T16:00:00.000Z");
    assert.equal(replaced?.length, 1);
    assert.equal(replaced?.[0]?.savedAt, "2026-10-09T16:00:00.000Z");
    assert.equal(upsertScenario(saved ?? [], " ", parsed, "2026-10-09T16:00:00.000Z"), null);
    assert.equal(upsertScenario(saved ?? [], "x".repeat(41), parsed, "2026-10-09T16:00:00.000Z"), null);
    const library = parseLibrary({
      v: 1,
      extra: true,
      scenarios: [
        { name: "Broken", savedAt: "2026-10-09T15:00:00.000Z", scenario: { symbol: "nope" }, noise: 1 },
        { name: "Desk", savedAt: "2026-10-09T15:00:00.000Z", scenario: parsed, noise: 2 },
      ],
    });
    assert.equal(library.length, 1);
    assert.equal(library[0]?.name, "Desk");
    assert.equal((library[0] as { noise?: number }).noise, undefined);
  });

  it("does not let a corrupt localStorage blob become state", () => {
    const mem = new Map<string, string>();
    const storage = {
      getItem: (key: string) => mem.get(key) ?? null,
      setItem: (key: string, value: string) => {
        mem.set(key, value);
      },
    };
    const parsed = parseScenario(JSON.parse(JSON.stringify(lab)));
    assert.ok(parsed);
    if (!parsed) return;
    writeLibrary(storage, [{ name: "Desk", savedAt: "2026-10-09T15:00:00.000Z", scenario: { ...parsed, extra: true } as typeof parsed }]);
    const raw = mem.get(SCENARIO_STORAGE_KEY) ?? "";
    assert.equal(raw.includes("extra"), false);
    assert.equal(readLibrary(storage)[0]?.scenario.symbol, "NOW");
    mem.set(SCENARIO_STORAGE_KEY, "{not json");
    assert.deepEqual(readLibrary(storage), []);
  });
});

describe("phase 2 csv", () => {
  it("quotes commas and exports the cube and the entry table", () => {
    assert.equal(csvField('say "hi"'), '"say ""hi"""');
    assert.equal(csvField("a,b"), '"a,b"');
    const chain = chainOf();
    const lab = editLab(createLab(chain), [
      {
        kind: "addStructure",
        label: "Synthetic",
        expiry: isoDate(EXPIRY),
        request: { template: "syntheticLong", strike: { by: "strike", strike: 140 } },
      },
      {
        kind: "addStructure",
        label: "Strangle",
        expiry: isoDate(EXPIRY),
        request: {
          template: "shortStrangle",
          put: { by: "strike", strike: 120 },
          call: { by: "strike", strike: 160 },
        },
      },
      { kind: "setCapitalOverride", id: "s2", dollars: 2500 },
    ], chain);
    const ev = evaluateLab(lab, chain);
    const synthetic = priced("Synthetic", ev);
    const cube = evaluationCubeCsv(ev);
    const lines = cube.trim().split("\n");
    assert.equal(lines[0], "structure,horizon,date,spot,pnl");
    const curve = synthetic.curves[0];
    const point = curve?.points[0];
    const horizon = ev.horizons.find((item) => item.id === curve?.horizonId);
    assert.ok(point && horizon);
    assert.ok(cube.includes(csvField(horizon!.label)));
    assert.ok(lines.some((row) => row.startsWith(`Synthetic,${csvField(horizon!.label)},${horizon!.date},${point!.spot},${point!.pnl}`)));

    const table = entryTableCsv(ev);
    const tableLines = table.trim().split("\n");
    assert.equal(
      tableLines[0],
      "label,expiry,legs,entry,debit,breakevens,maxLoss,maxGain,packages,idleCash,netDelta,dollarsAtRisk",
    );
    const syntheticLine = tableLines.find((row) => row.startsWith("Synthetic,"));
    const strangleLine = tableLines.find((row) => row.startsWith("Strangle,"));
    assert.ok(syntheticLine?.includes("1C 140 / -1P 140,mid,500,"));
    assert.ok(syntheticLine?.endsWith(",14500") || syntheticLine?.includes(",14500\n") || syntheticLine?.includes(",14500"));
    assert.match(syntheticLine ?? "", /,14500,unbounded,0,/);
    assert.match(strangleLine ?? "", /,unbounded,.*,4,0,/);
    assert.ok(strangleLine?.endsWith(",2500"));
  });
});

describe("phase 2 chain counts", () => {
  it("keeps open interest and volume when the feed sends them, including zero", () => {
    const chain = chainOf();
    const put = chain.expiries[0]?.strikes.find((row) => row.strike === 120)?.put;
    const call = chain.expiries[0]?.strikes.find((row) => row.strike === 160)?.call;
    assert.equal(put?.openInterest, 15);
    assert.equal(put?.volume, 0);
    assert.equal(call?.volume, 4);
    assert.equal(chain.expiries[0]?.strikes.find((row) => row.strike === 140)?.call?.openInterest, null);

    const schwab = parseSchwabChain(
      "NOW",
      {
        underlyingPrice: 140,
        callExpDateMap: {
          "2027-01-15:12": {
            "140.0": [{ putCall: "CALL", strikePrice: 140, bid: 19, ask: 21, volatility: 30, multiplier: 100, openInterest: 42, totalVolume: 7 }],
          },
        },
      },
      "2026-10-08T16:00:00.000Z",
    );
    assert.equal(schwab?.contracts[0]?.openInterest, 42);
    assert.equal(schwab?.contracts[0]?.volume, 7);

    const cboe = parseCboeChain(
      "NOW",
      {
        timestamp: "2026-10-08 16:00:00",
        data: {
          current_price: 140,
          options: [{ option: "NOW270115P00120000", bid: 2, ask: 2.4, iv: 0.3, open_interest: 11, volume: 0 }],
        },
      },
      "2026-10-08T16:00:00.000Z",
    );
    assert.equal(cboe?.contracts[0]?.openInterest, 11);
    assert.equal(cboe?.contracts[0]?.volume, 0);
  });
});
