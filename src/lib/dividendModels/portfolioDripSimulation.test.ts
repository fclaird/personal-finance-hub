import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  simulatePortfolioDripFromFacts,
  type DripPayment,
} from "./portfolioDripSimulation";

const holdings = [{ symbol: "XY", shares: 10 }];
const months = ["2024-01-31", "2024-02-29", "2024-03-31"];
const monthEndClose = (sym: string, me: string): number | null => {
  void sym;
  if (me === "2024-01-31") return 100;
  if (me === "2024-02-29") return 100;
  if (me === "2024-03-31") return 110;
  return null;
};
const constPrice = (price: number) => (sym: string, date: string): number => {
  void sym;
  void date;
  return price;
};
const noPrice = (sym: string, date: string): number | null => {
  void sym;
  void date;
  return null;
};

describe("simulatePortfolioDripFromFacts", () => {
  it("creates a ledger row with fractional shares on a single payment", () => {
    const payments: DripPayment[] = [{ symbol: "XY", payDate: "2024-02-15", amount: 1 }];

    const { points, ledger } = simulatePortfolioDripFromFacts(
      holdings,
      payments,
      months,
      constPrice(50),
      monthEndClose,
      "2024-03-31",
    );

    assert.equal(ledger.length, 1);
    const row = ledger[0]!;
    assert.equal(row.symbol, "XY");
    assert.equal(row.dividend_cash, 10);
    assert.equal(row.reinvest_price, 50);
    assert.equal(row.shares_added, 0.2);
    assert.equal(row.shares_after, 10.2);
    assert.equal(points.length, 3);
    assert.equal(points[1]!.total_dividends, 10);
  });

  it("compounds across multiple payments", () => {
    const payments: DripPayment[] = [
      { symbol: "XY", payDate: "2024-01-15", amount: 1 },
      { symbol: "XY", payDate: "2024-02-15", amount: 1 },
    ];

    const { ledger } = simulatePortfolioDripFromFacts(
      holdings,
      payments,
      months,
      constPrice(50),
      monthEndClose,
      "2024-03-31",
    );

    assert.equal(ledger.length, 2);
    assert.equal(ledger[0]!.shares_after, 10.2);
    assert.ok(Math.abs(ledger[1]!.shares_added - (10.2 * 1) / 50) < 1e-9);
    assert.ok(ledger[1]!.shares_after > ledger[0]!.shares_after);
  });

  it("composite NAV exceeds price-only when dividends reinvest", () => {
    const payments: DripPayment[] = [{ symbol: "XY", payDate: "2024-02-15", amount: 1 }];

    const { points } = simulatePortfolioDripFromFacts(
      holdings,
      payments,
      months,
      constPrice(50),
      monthEndClose,
      "2024-03-31",
    );

    const last = points[points.length - 1]!;
    assert.ok((last.portfolio_rebased_pct ?? -Infinity) > (last.price_only_rebased_pct ?? -Infinity));
  });

  it("skips payments with no pay-date price", () => {
    const payments: DripPayment[] = [{ symbol: "XY", payDate: "2024-02-15", amount: 1 }];

    const { ledger, points } = simulatePortfolioDripFromFacts(
      holdings,
      payments,
      months,
      noPrice,
      monthEndClose,
      "2024-03-31",
    );

    assert.equal(ledger.length, 0);
    assert.equal(points[1]!.total_dividends, 0);
  });
});
