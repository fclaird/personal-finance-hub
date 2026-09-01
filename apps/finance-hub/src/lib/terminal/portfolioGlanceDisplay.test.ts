import assert from "node:assert/strict";
import test from "node:test";

import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
import {
  indexToPortfolioDollars,
  portfolioDayUsdPnl,
  portfolioGlanceItemForDisplayMode,
} from "@/lib/terminal/portfolioGlanceDisplay";
import { PORTFOLIO_INDEX_BASE } from "@/lib/terminal/portfolioGlance";

test("indexToPortfolioDollars maps 100 to prior net value", () => {
  assert.ok(Math.abs(indexToPortfolioDollars(PORTFOLIO_INDEX_BASE, 1_000_000) - 1_000_000) < 1e-6);
  assert.ok(Math.abs(indexToPortfolioDollars(100.5, 1_000_000) - 1_005_000) < 1);
});

test("portfolioGlanceItemForDisplayMode remaps series to dollars", () => {
  const item: UsMarketGlanceItem = {
    id: "portfolio",
    label: "Portfolio",
    symbol: "PORT",
    last: 100.2,
    change: 0.2,
    changePct: 0.2,
    previousClose: 100,
    series: [{ idx: 0, close: 100, tsMs: 1 }, { idx: 1, close: 100.2, tsMs: 2 }],
    valueMode: "percent",
    netValue: 1_002_000,
    priorNetValue: 1_000_000,
  };
  const dollar = portfolioGlanceItemForDisplayMode(item, "dollar");
  assert.equal(dollar.valueMode, "price");
  assert.equal(dollar.last, 1_002_000);
  assert.equal(dollar.series[1]!.close, 1_002_000);
});

test("portfolioDayUsdPnl", () => {
  assert.equal(portfolioDayUsdPnl(1_050_000, 1_000_000), 50_000);
});
