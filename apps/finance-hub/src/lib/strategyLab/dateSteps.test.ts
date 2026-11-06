import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { addCalendarMonths, isoDate } from "@/lib/optionChain/chain";
import {
  STEP_MINUS,
  forwardDateSteps,
  forwardStepLabel,
  yearsUntilExpiry,
} from "@/lib/strategyLab/dateSteps";

const TODAY = isoDate("2026-10-08");

describe("forward date steps", () => {
  it("walks three-month steps, then months and weeks into a far expiry", () => {
    const expiry = isoDate("2029-01-19");
    const steps = forwardDateSteps(TODAY, expiry);
    assert.deepEqual(
      steps.map((step) => step.date),
      [
        "2026-10-08",
        "2027-01-08",
        "2027-04-08",
        "2027-07-08",
        "2027-10-08",
        "2028-01-08",
        "2028-04-08",
        "2028-07-08",
        "2028-10-08",
        "2028-10-19",
        "2028-11-19",
        "2028-12-19",
        "2029-01-05",
        "2029-01-12",
        "2029-01-19",
      ],
    );
    assert.deepEqual(
      steps.map((step) => step.kind),
      [
        "today",
        "quarter",
        "quarter",
        "quarter",
        "quarter",
        "quarter",
        "quarter",
        "quarter",
        "quarter",
        "expiryMonths",
        "expiryMonths",
        "expiryMonths",
        "expiryWeeks",
        "expiryWeeks",
        "expiry",
      ],
    );
    assert.equal(forwardStepLabel(steps[1]!, false).startsWith("+3 mo"), true);
    assert.equal(forwardStepLabel(steps.at(-3)!, false), `E${STEP_MINUS}2wk · Jan 5`);
    assert.equal(forwardStepLabel(steps.at(-2)!, false), `E${STEP_MINUS}1wk · Jan 12`);
    assert.equal(yearsUntilExpiry(steps.at(-1)!, expiry), 0);
    assert.ok(yearsUntilExpiry(steps[0]!, expiry) > 2);
  });

  it("names the two-week step with the month and day", () => {
    const expiry = isoDate("2027-06-18");
    const steps = forwardDateSteps(TODAY, expiry);
    const twoWeek = steps.find((step) => step.kind === "expiryWeeks" && step.weeks === 2);
    assert.ok(twoWeek);
    assert.equal(twoWeek.date, isoDate("2027-06-04"));
    assert.equal(forwardStepLabel(twoWeek, false), `E${STEP_MINUS}2wk · Jun 4`);
    assert.equal(forwardStepLabel(steps[0]!, true), "Today · Oct 8");
    assert.equal(forwardStepLabel(steps.at(-1)!, true), "Expiry · Jun 18");
  });

  it("drops steps before today and a quarterly step a few days from the three-month fence", () => {
    const soon = forwardDateSteps(TODAY, isoDate("2026-11-20"));
    assert.deepEqual(
      soon.map((step) => step.kind),
      ["today", "expiryMonths", "expiryWeeks", "expiryWeeks", "expiry"],
    );
    assert.equal(soon[1]!.months, 1);
    assert.ok(soon.every((step) => step.date >= TODAY));

    const expiry = isoDate("2027-07-10");
    const crowded = forwardDateSteps(TODAY, expiry);
    const fence = addCalendarMonths(expiry, -3);
    assert.equal(fence, isoDate("2027-04-10"));
    assert.equal(
      crowded.some((step) => step.date === isoDate("2027-04-08")),
      false,
    );
    const month = crowded.find((step) => step.date === fence);
    assert.equal(month?.kind, "expiryMonths");
    assert.equal(month?.months, 3);
  });

  it("keeps today and expiry when they are only a few days apart", () => {
    const steps = forwardDateSteps(TODAY, isoDate("2026-10-11"));
    assert.deepEqual(
      steps.map((step) => step.kind),
      ["today", "expiry"],
    );
    assert.deepEqual(forwardDateSteps(isoDate("2026-10-20"), isoDate("2026-10-11")).map((step) => step.kind), ["expiry"]);
  });
});
