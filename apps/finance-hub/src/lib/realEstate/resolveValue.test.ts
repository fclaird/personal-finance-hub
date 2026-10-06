import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { resolveOfficialSeries, type HpiObservation, type ValuationInput } from "@/lib/realEstate/resolveValue";

const hpi: HpiObservation[] = [
  { period: "2024-03", index: 100 },
  { period: "2024-06", index: 100 },
  { period: "2024-09", index: 110 },
];

function reading(partial: ValuationInput): ValuationInput {
  return partial;
}

describe("resolveOfficialSeries", () => {
  it("averages two AVM sources and keeps their spread", () => {
    const series = resolveOfficialSeries(
      [
        reading({ id: "z", asOf: "2024-06-02", valueUsd: 180_000, lowUsd: 170_000, highUsd: 190_000, source: "manual_avm", sourceDetail: "zillow" }),
        reading({ id: "r", asOf: "2024-06-04", valueUsd: 200_000, lowUsd: 195_000, highUsd: 210_000, source: "manual_avm", sourceDetail: "redfin" }),
      ],
      [],
      "2024-06",
    );
    assert.equal(series.length, 1);
    assert.equal(series[0]!.method, "avm_blend");
    assert.equal(series[0]!.valueUsd, 190_000);
    assert.equal(series[0]!.lowUsd, 170_000);
    assert.equal(series[0]!.highUsd, 210_000);
  });

  it("uses the median of three distinct AVM sources", () => {
    const series = resolveOfficialSeries(
      [
        reading({ id: "z", asOf: "2024-06-01", valueUsd: 100, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "zillow" }),
        reading({ id: "r", asOf: "2024-06-02", valueUsd: 300, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "redfin" }),
        reading({ id: "a", asOf: "2024-06-03", valueUsd: 200, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "realtor" }),
      ],
      [],
      "2024-06",
    );
    assert.equal(series[0]!.valueUsd, 200);
    assert.equal(series[0]!.lowUsd, 100);
    assert.equal(series[0]!.highUsd, 300);
  });

  it("counts two readings from the same source as one source", () => {
    const series = resolveOfficialSeries(
      [
        reading({ id: "z1", asOf: "2024-06-01", valueUsd: 100, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "zillow" }),
        reading({ id: "z2", asOf: "2024-06-20", valueUsd: 180, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "Zillow" }),
      ],
      [],
      "2024-06",
    );
    assert.equal(series.length, 0);
  });

  it("ignores a purchase price and an assessor figure", () => {
    const series = resolveOfficialSeries(
      [
        reading({ id: "p", asOf: "2025-10-09", valueUsd: 239_000, lowUsd: null, highUsd: null, source: "purchase", sourceDetail: "purchase" }),
        reading({ id: "c", asOf: "2024-06-01", valueUsd: 80_000, lowUsd: null, highUsd: null, source: "assessor", sourceDetail: "county" }),
        reading({ id: "z", asOf: "2024-06-02", valueUsd: 180_000, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "zillow" }),
      ],
      [],
      "2025-10",
    );
    assert.equal(series.length, 0);
  });

  it("anchors on an appraisal newer than the latest AVM set and scales later months by HPI", () => {
    const series = resolveOfficialSeries(
      [
        reading({ id: "z", asOf: "2024-03-02", valueUsd: 150_000, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "zillow" }),
        reading({ id: "r", asOf: "2024-03-04", valueUsd: 170_000, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "redfin" }),
        reading({ id: "ap", asOf: "2024-06-15", valueUsd: 200_000, lowUsd: null, highUsd: null, source: "appraisal", sourceDetail: "appraiser" }),
      ],
      hpi,
      "2024-09",
    );
    const march = series.find((point) => point.month === "2024-03");
    const june = series.find((point) => point.month === "2024-06");
    const september = series.find((point) => point.month === "2024-09");
    assert.equal(march?.method, "avm_blend");
    assert.equal(march?.valueUsd, 160_000);
    assert.equal(june?.method, "appraisal_anchor");
    assert.equal(june?.valueUsd, 200_000);
    assert.equal(september?.method, "hpi_from_appraisal");
    assert.equal(september?.valueUsd, 220_000);
  });

  it("does not rewrite months before the appraisal", () => {
    const series = resolveOfficialSeries(
      [
        reading({ id: "z", asOf: "2024-01-05", valueUsd: 100, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "zillow" }),
        reading({ id: "r", asOf: "2024-01-06", valueUsd: 120, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "redfin" }),
        reading({ id: "ap", asOf: "2024-06-01", valueUsd: 300, lowUsd: null, highUsd: null, source: "appraisal", sourceDetail: "appraiser" }),
      ],
      [],
      "2024-06",
    );
    assert.equal(series.find((point) => point.month === "2024-01")?.method, "avm_blend");
    assert.equal(series.find((point) => point.month === "2024-01")?.valueUsd, 110);
    assert.equal(series.find((point) => point.month === "2024-06")?.method, "appraisal_anchor");
  });

  it("steps from the last AVM blend when a newer estimate set supersedes an older appraisal", () => {
    const series = resolveOfficialSeries(
      [
        reading({ id: "ap", asOf: "2024-03-01", valueUsd: 200_000, lowUsd: null, highUsd: null, source: "appraisal", sourceDetail: "appraiser" }),
        reading({ id: "z", asOf: "2024-06-02", valueUsd: 210_000, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "zillow" }),
        reading({ id: "r", asOf: "2024-06-03", valueUsd: 230_000, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "redfin" }),
      ],
      hpi,
      "2024-09",
    );
    assert.equal(series.find((point) => point.month === "2024-03")?.method, "appraisal_anchor");
    assert.equal(series.find((point) => point.month === "2024-06")?.method, "avm_blend");
    assert.equal(series.find((point) => point.month === "2024-06")?.valueUsd, 220_000);
    assert.equal(series.find((point) => point.month === "2024-07")?.method, "hpi_from_official");
    assert.equal(series.find((point) => point.month === "2024-07")?.valueUsd, 220_000);
    assert.equal(series.find((point) => point.month === "2024-09")?.valueUsd, 242_000);
  });

  it("carries the last official value flat when HPI is missing", () => {
    const series = resolveOfficialSeries(
      [
        reading({ id: "z", asOf: "2024-06-01", valueUsd: 100, lowUsd: 90, highUsd: 110, source: "manual_avm", sourceDetail: "zillow" }),
        reading({ id: "r", asOf: "2024-06-02", valueUsd: 120, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "redfin" }),
      ],
      [],
      "2024-08",
    );
    assert.equal(series.find((point) => point.month === "2024-08")?.method, "hpi_from_official");
    assert.equal(series.find((point) => point.month === "2024-08")?.valueUsd, 110);
    assert.equal(series.find((point) => point.month === "2024-08")?.lowUsd, 90);
  });

  it("leaves a single AVM month without an official value", () => {
    const series = resolveOfficialSeries(
      [reading({ id: "z", asOf: "2024-06-01", valueUsd: 100, lowUsd: null, highUsd: null, source: "manual_avm", sourceDetail: "zillow" })],
      hpi,
      "2024-08",
    );
    assert.deepEqual(series, []);
  });
});
