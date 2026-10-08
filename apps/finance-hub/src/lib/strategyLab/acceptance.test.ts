import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";

import {
  calendarDaysBetween,
  formatExpiryLabel,
  isoDate,
  makeOptionChain,
  type ChainDraft,
  type DraftContract,
  type OptionChain,
} from "@/lib/optionChain/chain";
import {
  createLab,
  editLab,
  evaluateLab,
  expiryPnlAtSpot,
  type LabEvaluation,
  type PricedStructure,
} from "@/lib/strategyLab/lab";

/**
 * Printed mids from the Oct 8, 2026 desk notes:
 * NOW Jan 2029 (spot 136.58) and NOW Feb 2027 (spot 136.72).
 * AVGO June 2027 is the holiday snap, the 0.70% continuous yield, and fractional sizing.
 */

function draft(partial: Omit<ChainDraft, "quoteTime" | "fetchedAt" | "servedFrom" | "fallbackFrom" | "delayed"> & { delayed?: boolean }): ChainDraft {
  return {
    quoteTime: null,
    fetchedAt: "2026-10-08T16:13:00.000Z",
    servedFrom: "network",
    fallbackFrom: null,
    delayed: true,
    ...partial,
  };
}

function calls(expiry: string, rows: readonly (readonly [number, number, number])[]): DraftContract[] {
  return rows.map(([strike, bid, ask]) => ({
    expiry,
    right: "C" as const,
    strike,
    bid,
    ask,
    feedIv: null,
    multiplier: 100,
    root: null,
  }));
}

function chainOf(body: ChainDraft): OptionChain {
  const built = makeOptionChain(body);
  if (!built.ok) throw new Error(built.error);
  return built.chain;
}

function priced(ev: LabEvaluation, label: string): PricedStructure {
  const row = ev.structures.find((s) => s.spec.label === label);
  assert.ok(row, `missing ${label}`);
  assert.equal(row.status, "priced");
  if (row.status !== "priced") throw new Error("unreachable");
  return row;
}

function near(actual: number, expected: number, tol: number, label: string) {
  assert.ok(Math.abs(actual - expected) <= tol, `${label}: ${actual} vs ${expected} ± ${tol}`);
}

const JAN = "2029-01-19";
const FEB = "2027-02-19";
const AVGO_LISTED = "2027-06-17";

describe("NOW Jan 19 2029 acceptance", () => {
  const chain = chainOf(
    draft({
      symbol: "NOW",
      spot: 136.58,
      tradeDate: "2026-10-08",
      source: "cboe",
      dividendYieldHint: 0,
      contracts: calls(JAN, [
        [120, 53.85, 59.25],
        [150, 43.4, 44.7],
        [160, 39.75, 41.75],
        [210, 27.75, 29.05],
      ]),
    }),
  );

  const lab = editLab(
    createLab(chain),
    [
      { kind: "setAssumptions", patch: { rate: 0.04, dividendYield: 0, ivSource: "mid" } },
      { kind: "setBasis", basis: { kind: "equalCapital", capital: 10_000, units: "whole" } },
      {
        kind: "addStructure",
        label: "A",
        expiry: isoDate(JAN),
        request: {
          template: "callDebitSpread",
          long: { by: "strike", strike: 150 },
          short: { by: "strike", strike: 210 },
        },
        entry: { kind: "limit", netPerShare: 15.55 },
      },
      {
        kind: "addStructure",
        label: "B",
        expiry: isoDate(JAN),
        request: {
          template: "callDebitSpread",
          long: { by: "strike", strike: 160 },
          short: { by: "strike", strike: 210 },
        },
        entry: { kind: "limit", netPerShare: 12.35 },
      },
      {
        kind: "addStructure",
        label: "C",
        expiry: isoDate(JAN),
        request: {
          template: "zebra",
          long: { by: "strike", strike: 120 },
          short: { by: "strike", strike: 210 },
        },
        entry: { kind: "limit", netPerShare: 84.7 },
      },
    ],
    chain,
  );
  const ev = evaluateLab(lab, chain);
  const a = priced(ev, "A");
  const b = priced(ev, "B");
  const c = priced(ev, "C");

  it("counts 834 days and a shared Monday halfway", () => {
    assert.equal(calendarDaysBetween(isoDate("2026-10-08"), isoDate(JAN)), 834);
    assert.equal(a.days, 834);
    assert.equal(a.ownHalfway, isoDate("2027-11-29"));
    assert.equal(formatExpiryLabel(isoDate(JAN)), "Fri Jan 19, 2029");
    assert.equal(formatExpiryLabel(a.ownHalfway), "Mon Nov 29, 2027");
    assert.deepEqual(
      ev.horizons.map((h) => h.date),
      [isoDate("2027-11-29"), isoDate(JAN)],
    );
    assert.match(ev.horizons[0]!.label, /Halfway to Fri Jan 19, 2029/);
    assert.match(ev.horizons[0]!.label, /Mon Nov 29, 2027/);
    assert.equal(ev.horizons[0]!.shared, true);
    assert.equal(ev.issues.some((issue) => issue.severity === "block"), false);
  });

  it("reproduces ticket debits, breakevens, and $10k whole-contract sizing", () => {
    assert.equal(a.debit, 1555);
    assert.equal(b.debit, 1235);
    assert.equal(c.debit, 8470);
    assert.deepEqual(a.risk.breakevens, [165.55]);
    assert.deepEqual(b.risk.breakevens, [172.35]);
    assert.deepEqual(c.risk.breakevens, [162.35]);
    assert.equal(a.risk.maxLoss, 1555);
    assert.equal(b.risk.maxLoss, 1235);
    assert.equal(c.risk.maxLoss, 8470);
    assert.equal(a.risk.maxGain, 4445);
    assert.equal(b.risk.maxGain, 3765);
    assert.equal(c.risk.maxGain, "unbounded");
    assert.equal(c.risk.slopeAbove, 100);
    assert.equal(a.risk.intrinsic, 0);
    assert.equal(a.risk.extrinsic, 1555);
    assert.equal(c.risk.intrinsic, 3316);
    assert.equal(c.risk.extrinsic, 5154);
    near(a.naturalPerShare ?? NaN, 16.95, 1e-9, "A natural");
    near(a.midPerShare ?? NaN, 15.65, 0.001, "A mid");
    near(b.midPerShare ?? NaN, 12.35, 0.001, "B mid");
    near(c.midPerShare ?? NaN, 84.7, 0.001, "C mid");

    for (const row of [a, b, c]) assert.equal(row.sizing.status, "sized");
    if (a.sizing.status !== "sized" || b.sizing.status !== "sized" || c.sizing.status !== "sized") return;
    assert.equal(a.sizing.packages, 6);
    assert.equal(a.sizing.idleCash, 670);
    assert.equal(b.sizing.packages, 8);
    assert.equal(b.sizing.idleCash, 120);
    assert.equal(c.sizing.packages, 1);
    assert.equal(c.sizing.idleCash, 1530);
    near(a.sizing.leverage ?? NaN, 1.35, 0.02, "A leverage");
    near(b.sizing.leverage ?? NaN, 1.46, 0.02, "B leverage");
    near(c.sizing.leverage ?? NaN, 1.39, 0.02, "C leverage");
  });

  it("pins solved IVs, package greeks, and expiry dollars", () => {
    const iv = (row: PricedStructure, strike: number) => row.legs.find((leg) => leg.strike === strike)?.iv ?? NaN;
    near((iv(a, 150) ?? 0) * 100, 55.2, 0.05, "150 IV");
    near((iv(a, 210) ?? 0) * 100, 53.8, 0.05, "210 IV");
    near((iv(b, 160) ?? 0) * 100, 54.7, 0.05, "160 IV");
    near((iv(c, 120) ?? 0) * 100, 58.1, 0.05, "120 IV");

    assert.ok(a.greeks && b.greeks && c.greeks);
    near(a.greeks!.delta, 16.5, 0.1, "A delta");
    near(a.greeks!.gamma, -0.038, 0.002, "A gamma");
    near(a.greeks!.theta, 0.08, 0.02, "A theta");
    near(a.greeks!.vega, -6.77, 0.05, "A vega");
    near(b.greeks!.delta, 13.4, 0.1, "B delta");
    near(b.greeks!.gamma, -0.025, 0.002, "B gamma");
    near(b.greeks!.theta, 0.03, 0.02, "B theta");
    near(b.greeks!.vega, -4.43, 0.05, "B vega");
    near(c.greeks!.delta, 101.4, 0.1, "C delta");
    near(c.greeks!.gamma, 0.164, 0.002, "C gamma");
    near(c.greeks!.theta, -2.46, 0.02, "C theta");
    near(c.greeks!.vega, 47.41, 0.05, "C vega");

    assert.equal(expiryPnlAtSpot(c.legs, c.debit, 300), 18530);
    const expiry = ev.horizons.find((h) => h.date === isoDate(JAN));
    assert.ok(expiry);
    const at210 = a.curves.find((curve) => curve.horizonId === expiry!.id)?.points.find((p) => p.spot === 210);
    assert.equal(at210?.pnl, 26670);
    const flat = a.curves.find((curve) => curve.horizonId === expiry!.id)?.points.find((p) => p.spot === chain.spot);
    assert.equal(flat?.pnl, 6 * -1555);

    const stock = ev.stock.find((series) => series.horizonId === expiry!.id);
    assert.ok(stock);
    for (const point of stock!.points) {
      assert.equal(point.pnl, ((point.spot - chain.spot) / chain.spot) * 10_000);
    }
  });

  it("leaves the dividend at 0 when the feed only hints", () => {
    const hinted = chainOf(
      draft({
        symbol: "NOW",
        spot: 136.58,
        tradeDate: "2026-10-08",
        source: "schwab",
        dividendYieldHint: 0.012,
        contracts: calls(JAN, [[150, 43.4, 44.7]]),
      }),
    );
    assert.equal(createLab(hinted).assumptions.dividendYield, 0);
    assert.equal(hinted.dividendYieldHint, 0.012);
  });
});

describe("NOW Feb 19 2027", () => {
  const chain = chainOf(
    draft({
      symbol: "NOW",
      spot: 136.72,
      tradeDate: "2026-10-08",
      source: "cboe",
      dividendYieldHint: null,
      contracts: calls(FEB, [
        [115, 29.55, 31.7],
        [130, 20.65, 22.45],
        [145, 14.15, 15.5],
        [150, 12.35, 13.2],
        [200, 3.25, 4.2],
      ]),
    }),
  );

  it("sizes the three ticket structures and lands halfway on Dec 14", () => {
    assert.equal(calendarDaysBetween(isoDate("2026-10-08"), isoDate(FEB)), 134);
    const lab = editLab(
      createLab(chain),
      [
        {
          kind: "addStructure",
          label: "A",
          expiry: isoDate(FEB),
          request: {
            template: "callDebitSpread",
            long: { by: "strike", strike: 130 },
            short: { by: "strike", strike: 200 },
          },
          entry: { kind: "limit", netPerShare: 17.83 },
        },
        {
          kind: "addStructure",
          label: "B",
          expiry: isoDate(FEB),
          request: {
            template: "callDebitSpread",
            long: { by: "strike", strike: 150 },
            short: { by: "strike", strike: 200 },
          },
          entry: { kind: "limit", netPerShare: 9.05 },
        },
        {
          kind: "addStructure",
          label: "C",
          expiry: isoDate(FEB),
          request: {
            template: "zebra",
            long: { by: "strike", strike: 115 },
            short: { by: "strike", strike: 145 },
          },
          entry: { kind: "limit", netPerShare: 46.43 },
        },
      ],
      chain,
    );
    const ev = evaluateLab(lab, chain);
    const a = priced(ev, "A");
    const b = priced(ev, "B");
    const c = priced(ev, "C");
    assert.equal(a.days, 134);
    assert.equal(a.ownHalfway, isoDate("2026-12-14"));
    assert.equal(a.debit, 1783);
    assert.equal(b.debit, 905);
    assert.equal(c.debit, 4643);
    assert.deepEqual(a.risk.breakevens, [147.83]);
    assert.deepEqual(b.risk.breakevens, [159.05]);
    assert.deepEqual(c.risk.breakevens, [138.22]);
    assert.equal(a.risk.intrinsic, 672);
    assert.equal(a.risk.extrinsic, 1111);
    assert.equal(c.risk.intrinsic, 4344);
    assert.equal(c.risk.extrinsic, 299);
    assert.equal(a.risk.maxGain, 5217);
    assert.equal(b.risk.maxGain, 4095);
    assert.equal(c.risk.maxGain, "unbounded");
    assert.equal(a.naturalPerShare, 19.2);
    if (a.sizing.status !== "sized" || b.sizing.status !== "sized" || c.sizing.status !== "sized") {
      assert.fail("expected sized packages");
    }
    assert.equal(a.sizing.packages, 5);
    assert.equal(a.sizing.idleCash, 1085);
    assert.equal(b.sizing.packages, 11);
    assert.equal(b.sizing.idleCash, 45);
    assert.equal(c.sizing.packages, 2);
    assert.equal(c.sizing.idleCash, 714);
    near(a.greeks?.delta ?? NaN, 46.6, 0.6, "Feb A delta");
    near(b.greeks?.delta ?? NaN, 28.8, 0.6, "Feb B delta");
    near(c.greeks?.delta ?? NaN, 102.8, 0.6, "Feb C delta");
  });

  it("picks the 75/50 ZEBRA as 115 and 145", () => {
    const lab = editLab(createLab(chain), {
      kind: "addStructure",
      label: "Z",
      expiry: isoDate(FEB),
      request: {
        template: "zebra",
        long: { by: "delta", delta: 0.75 },
        short: { by: "delta", delta: 0.5 },
      },
    }, chain);
    const row = priced(evaluateLab(lab, chain), "Z");
    assert.deepEqual(
      row.legs.map((leg) => [leg.strike, leg.ratio]),
      [
        [115, 2],
        [145, -1],
      ],
    );
  });
});

describe("AVGO June 2027", () => {
  const chain = chainOf(
    draft({
      symbol: "AVGO",
      spot: 340,
      tradeDate: "2026-10-08",
      source: "schwab",
      dividendYieldHint: 0.007,
      contracts: calls(AVGO_LISTED, [
        [300, 62.1, 63.3],
        [360, 28.4, 29.2],
        [420, 12.05, 12.35],
      ]),
    }),
  );

  it("snaps June 18 onto the listed Thursday and changes price when q is 0.70%", () => {
    assert.equal(calendarDaysBetween(isoDate("2026-10-01"), isoDate(AVGO_LISTED)), 259);
    assert.equal(calendarDaysBetween(isoDate("2026-10-08"), isoDate(AVGO_LISTED)), 252);
    assert.equal(formatExpiryLabel(isoDate(AVGO_LISTED)), "Thu Jun 17, 2027");
    const lab = editLab(createLab(chain), {
      kind: "addStructure",
      label: "A",
      expiry: isoDate("2027-06-18"),
      request: { template: "longCall", strike: { by: "strike", strike: 360 } },
      entry: { kind: "mid" },
    }, chain);
    assert.equal(lab.structures[0]?.expiry, isoDate(AVGO_LISTED));
    assert.equal(lab.structures[0]?.snappedFrom, isoDate("2027-06-18"));
    assert.equal(lab.assumptions.dividendYield, 0);

    const withYield = editLab(lab, { kind: "setAssumptions", patch: { dividendYield: 0.007 } }, chain);
    const plain = priced(evaluateLab(lab, chain), "A");
    const yielded = priced(evaluateLab(withYield, chain), "A");
    const halfwayId = (ev: LabEvaluation) => ev.horizons.find((h) => h.date === plain.ownHalfway)?.id;
    const pnlAt = (row: PricedStructure, ev: LabEvaluation, spot: number) => {
      const id = halfwayId(ev);
      return row.curves.find((curve) => curve.horizonId === id)?.points.find((p) => p.spot === spot)?.pnl;
    };
    const moved = chain.spot * 2;
    const evPlain = evaluateLab(lab, chain);
    const evYield = evaluateLab(withYield, chain);
    const left = pnlAt(plain, evPlain, moved);
    const right = pnlAt(yielded, evYield, moved);
    assert.ok(left != null && right != null);
    assert.notEqual(left, right);
    assert.equal(plain.days, 252);
  });

  it("sizes a fractional package as a non-integer", () => {
    const lab = editLab(
      createLab(chain),
      [
        { kind: "setBasis", basis: { kind: "equalCapital", capital: 10_000, units: "fractional" } },
        {
          kind: "addStructure",
          label: "A",
          expiry: isoDate(AVGO_LISTED),
          request: { template: "longCall", strike: { by: "strike", strike: 420 } },
          entry: { kind: "limit", netPerShare: 12.2 },
        },
      ],
      chain,
    );
    const row = priced(evaluateLab(lab, chain), "A");
    assert.equal(row.debit, 1220);
    assert.equal(row.sizing.status, "sized");
    if (row.sizing.status !== "sized") return;
    assert.ok(!Number.isInteger(row.sizing.packages));
    near(row.sizing.packages, 10_000 / 1220, 1e-9, "fractional packages");
    assert.equal(row.sizing.idleCash, 0);
  });
});

describe("mixed expiries", () => {
  it("gives each structure its own halfway and names a shared entry date", () => {
    const chain = chainOf(
      draft({
        symbol: "NOW",
        spot: 136.58,
        tradeDate: "2026-10-08",
        source: "cboe",
        dividendYieldHint: null,
        contracts: [...calls(JAN, [[150, 43.4, 44.7], [210, 27.75, 29.05]]), ...calls(FEB, [[130, 20.65, 22.45], [200, 3.25, 4.2]])],
      }),
    );
    const lab = editLab(
      createLab(chain),
      [
        {
          kind: "setHorizons",
          horizons: [{ kind: "entry" }, { kind: "fractionToAnchor", fraction: 0.5 }, { kind: "anchorExpiry" }],
        },
        {
          kind: "addStructure",
          label: "Jan",
          expiry: isoDate(JAN),
          request: {
            template: "callDebitSpread",
            long: { by: "strike", strike: 150 },
            short: { by: "strike", strike: 210 },
          },
        },
        {
          kind: "addStructure",
          label: "Feb",
          expiry: isoDate(FEB),
          request: {
            template: "callDebitSpread",
            long: { by: "strike", strike: 130 },
            short: { by: "strike", strike: 200 },
          },
        },
      ],
      chain,
    );
    const ev = evaluateLab(lab, chain);
    const shared = ev.horizons.filter((h) => h.shared);
    assert.equal(shared.length, 1);
    assert.match(shared[0]!.label, /Shared date/);
    const janHalf = ev.horizons.find((h) => h.structureId === "s1" && h.date === isoDate("2027-11-29"));
    const febHalf = ev.horizons.find((h) => h.structureId === "s2" && h.date === isoDate("2026-12-14"));
    assert.ok(janHalf);
    assert.ok(febHalf);
    assert.match(janHalf!.label, /Jan/);
    assert.match(febHalf!.label, /Feb/);
    assert.equal(janHalf!.shared, false);
  });
});

describe("chinese wall", () => {
  it("does not mention trader orders in the chain or lab source", () => {
    const root = path.join(process.cwd(), "src", "lib");
    const files: string[] = [];
    const walk = (dir: string) => {
      for (const name of fs.readdirSync(dir)) {
        const full = path.join(dir, name);
        if (fs.statSync(full).isDirectory()) walk(full);
        else if (full.endsWith(".ts") && !full.endsWith(".test.ts")) files.push(full);
      }
    };
    walk(path.join(root, "optionChain"));
    walk(path.join(root, "strategyLab"));
    assert.ok(files.length > 0);
    for (const file of files) {
      const text = fs.readFileSync(file, "utf8");
      assert.doesNotMatch(text, /\bschwabFetch\b/);
      assert.doesNotMatch(text, /\/orders/);
      assert.doesNotMatch(text, /previewOrder/);
    }
  });
});
