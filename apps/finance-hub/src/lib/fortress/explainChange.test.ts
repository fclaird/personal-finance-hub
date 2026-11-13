import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { describeSigmaMove, explainMeasuredChange } from "@/lib/fortress/explainChange";
import { buildReturnReport } from "@/lib/fortress/returns";
import type { AdjBar } from "@/lib/market/adjustedClose";

function addDays(iso: string, days: number): string {
  return new Date(Date.parse(`${iso}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);
}

function bars(values: readonly number[], start = "2024-01-01"): AdjBar[] {
  let price = 100;
  const out: AdjBar[] = [{ date: start, adjClose: price }];
  for (let i = 0; i < values.length; i++) {
    price *= 1 + values[i]!;
    out.push({ date: addDays(start, i + 1), adjClose: price });
  }
  return out;
}

const count = 120;
const asOf = addDays("2024-01-01", count);
const low = Array.from({ length: count }, (_, index) => (index % 2 === 0 ? -0.002 : 0.002));
const high = Array.from({ length: count }, (_, index) => (index % 2 === 0 ? -0.03 : 0.02));
const bench = Array.from({ length: count }, (_, index) => (index % 2 === 0 ? -0.01 : 0.008));
const series = [
  { symbol: "LOW", bars: bars(low) },
  { symbol: "HIGH", bars: bars(high) },
  { symbol: "SPY", bars: bars(bench) },
];

function holding(symbol: string, weight: number | null, proxy = false) {
  return { symbol, weight, proxy };
}

function report(before: ReturnType<typeof holding>[], after: ReturnType<typeof holding>[]) {
  return buildReturnReport({ asOf, benchmark: "SPY", series, before, after });
}

function textOf(explained: ReturnType<typeof explainMeasuredChange>): string {
  return [explained.lead, ...explained.sentences].join(" ");
}

describe("measured change explanations", () => {
  it("separates percentage points from a relative percent and refuses a zero baseline", () => {
    const move = describeSigmaMove(0.02, 0.03);
    assert.equal(move.percentagePoints, 1);
    assert.ok(move.relativePercent != null && Math.abs(move.relativePercent - 50) < 1e-9);
    assert.equal(move.direction, "increased");
    assert.match(move.relativeSentence, /percentage-point/);
    assert.match(move.relativeSentence, /statistical-significance test/);

    const zero = describeSigmaMove(0, 0.01);
    assert.equal(zero.percentagePoints, 1);
    assert.equal(zero.relativePercent, null);
    assert.match(zero.relativeSentence, /undefined because the starting daily variability is zero/);
  });

  it("says measured swings increased or decreased from the recomputed sigma", () => {
    const up = explainMeasuredChange({
      report: report([holding("LOW", 0.9), holding("HIGH", 0.1)], [holding("LOW", 0.1), holding("HIGH", 0.9)]),
      funding: { beforeNav: 100_000, afterNav: 100_000, externalCapitalChange: 0, debtChange: 0 },
      scopeLabel: "Synthetic weights. Not a live book.",
    });
    const down = explainMeasuredChange({
      report: report([holding("LOW", 0.1), holding("HIGH", 0.9)], [holding("LOW", 0.9), holding("HIGH", 0.1)]),
      funding: { beforeNav: 100_000, afterNav: 100_000, externalCapitalChange: 0, debtChange: 0 },
      scopeLabel: "Synthetic weights. Not a live book.",
    });
    assert.equal(up.sigmaDirection, "increased");
    assert.equal(down.sigmaDirection, "decreased");
    assert.match(up.lead, /percentage points/);
    assert.match(down.lead, /percentage points/);
    assert.match(textOf(up), /replacement inside the book/);
    assert.equal(up.limited, false);
    assert.doesNotMatch(textOf(up), /statistically significant/i);
  });

  it("keeps pairwise correlations unchanged and attributes a smaller percentage to new cash", () => {
    const built = report([holding("LOW", 0.5), holding("HIGH", 0.5)], [holding("LOW", 0.25), holding("HIGH", 0.25)]);
    const pairBefore = built.full.before.find((pair) => pair.a === "LOW" && pair.b === "HIGH");
    const pairAfter = built.full.after.find((pair) => pair.a === "LOW" && pair.b === "HIGH");
    assert.equal(pairBefore?.correlation, pairAfter?.correlation);
    const explained = explainMeasuredChange({
      report: built,
      funding: { beforeNav: 100_000, afterNav: 200_000, externalCapitalChange: 100_000, debtChange: 0 },
      scopeLabel: "Synthetic weights. Not a live book.",
    });
    assert.equal(explained.sigmaDirection, "decreased");
    const body = textOf(explained);
    assert.match(body, /did not change/);
    assert.match(body, /New capital/);
    assert.match(body, /dollar variability is essentially unchanged/i);
    const relative = explained.rows.find((row) => row.label === "Relative to starting sigma");
    assert.equal(relative?.change, "-50.0%");
    const points = explained.rows.find((row) => row.label === "Daily sigma");
    assert.match(points?.change ?? "", /percentage points/);
  });

  it("keeps a signed contribution and does not treat a high correlation on a small weight as the portfolio effect", () => {
    const built = report([holding("LOW", 1), holding("HIGH", 0)], [holding("LOW", 1), holding("HIGH", -0.05)]);
    const explained = explainMeasuredChange({
      report: built,
      funding: { beforeNav: 100_000, afterNav: 100_000, externalCapitalChange: 0, debtChange: 0 },
      scopeLabel: "Synthetic weights. Not a live book.",
    });
    const high = built.afterRisk.contributions.find((row) => row.symbol === "HIGH");
    assert.ok(high && high.contribution < 0);
    const body = textOf(explained);
    assert.match(body, /HIGH's contribution/);
    assert.match(body, /negative contribution/);
    assert.match(body, /Size and funding|size and its funding/i);
    const row = explained.rows.find((item) => item.label.startsWith("HIGH correlation"));
    assert.ok(row);
    assert.match(`${row?.before} ${row?.after}`, /\d/);
  });

  it("refuses a favorable story when history is missing, short, or an option weight is unknown", () => {
    const missing = explainMeasuredChange({
      report: buildReturnReport({
        asOf,
        benchmark: "SPY",
        series: [{ symbol: "LOW", bars: null, reason: "no-adjclose" }, { symbol: "SPY", bars: bars(bench) }],
        before: [holding("LOW", 1)],
        after: [holding("LOW", 0.2)],
      }),
      funding: null,
      scopeLabel: "Synthetic weights. Not a live book.",
    });
    assert.equal(missing.limited, true);
    assert.equal(missing.sigmaDirection, "unknown");
    assert.doesNotMatch(textOf(missing), /Measured daily swings (increased|decreased)/);
    assert.match(missing.lead, /cannot be stated/);

    const shortBars = bars(high.slice(0, 10));
    const short = explainMeasuredChange({
      report: buildReturnReport({
        asOf,
        benchmark: "SPY",
        series: [{ symbol: "HIGH", bars: shortBars }, { symbol: "SPY", bars: bars(bench) }],
        before: [holding("HIGH", 1)],
        after: [holding("HIGH", 1)],
      }),
      funding: null,
      scopeLabel: "Synthetic weights. Not a live book.",
    });
    assert.equal(short.limited, true);
    assert.match(textOf(short), /short-history|fewer than 60/);
    assert.doesNotMatch(textOf(short), /Measured daily swings (increased|decreased)/);

    const option = explainMeasuredChange({
      report: buildReturnReport({
        asOf,
        benchmark: "SPY",
        series,
        before: [holding("LOW", null, true)],
        after: [holding("LOW", null, true)],
      }),
      funding: null,
      scopeLabel: "Synthetic option weight. Not a live book.",
    });
    assert.equal(option.limited, true);
    const optionText = textOf(option);
    assert.match(optionText, /option Greek delta/);
    assert.match(optionText, /cannot complete a pass/);
    assert.doesNotMatch(optionText, /Measured daily swings (increased|decreased)/);

    const unloaded = explainMeasuredChange({ report: null, funding: null, scopeLabel: "Synthetic 1,000 shares of SYN." });
    assert.match(unloaded.lead, /SYN/);
    assert.match(unloaded.lead, /not loaded/);
    assert.equal(unloaded.definitions.length, 3);
  });
});
