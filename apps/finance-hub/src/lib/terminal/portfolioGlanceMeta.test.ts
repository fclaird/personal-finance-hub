import assert from "node:assert/strict";
import test from "node:test";

import { buildTileChartRows } from "@/lib/market/glanceTileChartRows";
import {
  bridgePortfolioSeriesGaps,
  buildPortfolioIndexSeries,
  detectPortfolioCashFlowAdjusted,
  detectPortfolioIntradayStale,
} from "@/lib/terminal/portfolioGlance";
import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

test("detectPortfolioIntradayStale when DB tail disagrees with live index", () => {
  const prior = 1_000_000;
  const lastIndex = 100.5;
  const sessionTotals = [
    { total: 1_000_000 },
    { total: 1_000_100 },
  ];
  assert.equal(detectPortfolioIntradayStale(sessionTotals, prior, lastIndex, 0), true);
});

test("detectPortfolioCashFlowAdjusted after withdrawal-shaped drop", () => {
  const t0 = Date.parse("2026-05-22T15:00:00.000Z");
  const t1 = Date.parse("2026-05-22T16:00:00.000Z");
  const sessionTotals = [
    { tsMs: t0, total: 1_000_000 },
    { tsMs: t1, total: 900_000 },
  ];
  assert.equal(detectPortfolioCashFlowAdjusted(sessionTotals, -95_000), true);
});

test("sparse portfolio path has no null chart breaks after bridge and tile rows", () => {
  const t0 = Date.parse("2026-05-22T14:00:00.000Z");
  const t1 = Date.parse("2026-05-22T18:00:00.000Z");
  const series = bridgePortfolioSeriesGaps(
    buildPortfolioIndexSeries(
      [
        { tsMs: t0, total: 1_000_000 },
        { tsMs: t1, total: 1_004_000 },
      ],
      1_000_000,
      1_004_000,
      "2026-05-22",
      t1,
    ),
  );
  const item: UsMarketGlanceItem = {
    id: "portfolio",
    label: "Portfolio",
    symbol: "PORT",
    last: series[series.length - 1]!.close,
    change: 0.4,
    changePct: 0.4,
    previousClose: 100,
    series,
    valueMode: "percent",
  };
  const rows = buildTileChartRows(item, { omitPriorAnchor: true });
  assert.equal(
    rows.find((r) => r.regular == null && r.extended == null),
    undefined,
  );
});
