import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { simulatePortfolioMonthlyFromFacts, type SymbolMonthFacts } from "./portfolioSimulation";

function factsMap(data: Record<string, Record<string, SymbolMonthFacts>>) {
  return (symbol: string, monthEnd: string): SymbolMonthFacts | null => data[symbol]?.[monthEnd] ?? null;
}

describe("simulatePortfolioMonthlyFromFacts", () => {
  const months = ["2024-01-31", "2024-02-29"];
  const holdings = [{ symbol: "XY", shares: 10 }];
  const lookup = factsMap({
    XY: {
      "2024-01-31": { close_eom: 100, dividend_per_share: 1 },
      "2024-02-29": { close_eom: 100, dividend_per_share: 1 },
    },
  });

  it("withdraw mode accumulates cash in NAV", () => {
    const pts = simulatePortfolioMonthlyFromFacts(holdings, months, lookup, "withdraw", "2024-02-29");
    assert.equal(pts.length, 2);
    assert.equal(pts[0]!.total_dividends, 10);
    assert.equal(pts[0]!.nav_total, 1000 + 10);
    assert.equal(pts[1]!.nav_total, 1000 + 20);
  });

  it("reinvest mode grows share-equivalent NAV faster than withdraw", () => {
    const withdraw = simulatePortfolioMonthlyFromFacts(holdings, months, lookup, "withdraw", "2024-02-29");
    const reinvest = simulatePortfolioMonthlyFromFacts(holdings, months, lookup, "reinvest", "2024-02-29");
    const wNav = withdraw[withdraw.length - 1]!.nav_total!;
    const rNav = reinvest[reinvest.length - 1]!.nav_total!;
    assert.ok(rNav > wNav);
  });

  it("price_only_rebased_pct is flat when prices unchanged", () => {
    const pts = simulatePortfolioMonthlyFromFacts(holdings, months, lookup, "reinvest", "2024-02-29");
    assert.equal(pts[0]!.price_only_rebased_pct, 0);
    assert.equal(pts[1]!.price_only_rebased_pct, 0);
  });

  it("reinvest portfolio_rebased_pct is at least price_only after dividends reinvest", () => {
    const pts = simulatePortfolioMonthlyFromFacts(holdings, months, lookup, "reinvest", "2024-02-29");
    for (const p of pts) {
      const port = p.portfolio_rebased_pct ?? 0;
      const priceOnly = p.price_only_rebased_pct ?? 0;
      assert.ok(port >= priceOnly - 1e-9);
    }
    assert.ok((pts[1]!.portfolio_rebased_pct ?? 0) > (pts[1]!.price_only_rebased_pct ?? 0));
  });
});
