import assert from "node:assert/strict";
import test from "node:test";

import { portfolioBaselineNote, portfolioChangeLabel } from "@/lib/terminal/portfolioChangeCaption";
import { portfolioPctFromMarkedValues, presentPortfolioDayChange } from "@/lib/terminal/portfolioDayMove";

test("portfolioPctFromMarkedValues matches the performance/today weighting", () => {
  const one = portfolioPctFromMarkedValues([{ marketValue: 1034.4, changePctPoints: 3.44 }]);
  assert.ok(one != null && Math.abs(one - 3.44) < 1e-9);

  const weighted = portfolioPctFromMarkedValues([
    { marketValue: 1000, changePctPoints: 10 },
    { marketValue: 1000, changePctPoints: 0 },
  ]);
  assert.ok(weighted != null && Math.abs(weighted - 4.7619047619) < 1e-6);
});

test("a stale baseline is labeled since that date, not Day", () => {
  const presented = presentPortfolioDayChange({
    netValue: 5_665_920,
    priorNetValue: 5_095_920,
    netCashFlow: 0,
    sessionYmd: "2026-10-06",
    quotePortfolioPct: null,
    baseline: { status: "stale", staleBaselineYmd: "2026-09-30" },
  });
  assert.equal(portfolioChangeLabel(presented.caption), "since Sep 30");
  assert.equal(presented.priorNetValue, 5_095_920);
  assert.ok(presented.changePct != null && Math.abs(presented.changePct - 11.1853364) < 1e-4);
  assert.equal(
    portfolioBaselineNote(presented.caption),
    "Last stored baseline is 2026-09-30, not the prior session close",
  );
});

test("a stale baseline uses the position day percent when quotes exist", () => {
  const presented = presentPortfolioDayChange({
    netValue: 5_665_920,
    priorNetValue: 5_095_920,
    netCashFlow: 0,
    sessionYmd: "2026-10-06",
    quotePortfolioPct: 3.44,
    baseline: { status: "stale", staleBaselineYmd: "2026-09-30" },
  });
  assert.equal(portfolioChangeLabel(presented.caption), "Day");
  assert.equal(presented.changePct, 3.44);
  assert.ok(Math.abs(presented.priorNetValue - 5_665_920 / 1.0344) < 1e-6);
  assert.equal(portfolioBaselineNote(presented.caption), null);
});

test("a real prior-session baseline stays a one-day change", () => {
  const presented = presentPortfolioDayChange({
    netValue: 5_150_000,
    priorNetValue: 5_000_000,
    netCashFlow: 0,
    sessionYmd: "2026-10-06",
    quotePortfolioPct: null,
    baseline: { status: "prior_session" },
  });
  assert.equal(portfolioChangeLabel(presented.caption), "Day");
  assert.ok(presented.changePct != null && Math.abs(presented.changePct - 3) < 1e-9);
  assert.equal(presented.priorNetValue, 5_000_000);
  assert.equal(portfolioBaselineNote(presented.caption), null);
});
