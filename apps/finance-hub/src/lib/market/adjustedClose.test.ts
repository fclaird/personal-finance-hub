import assert from "node:assert/strict";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { adjustedClosesFromYahooChartResult } from "@/lib/market/adjustedClose";
import { readAdjustedSeries, writeAdjustedSeries } from "@/lib/market/adjustedCloseCache";

function chart(closes: Array<number | null>, adjusted: Array<number | null> | null, stamps: number[]) {
  const indicators: Record<string, unknown> = {
    quote: [{ close: closes, open: closes, high: closes, low: closes, volume: closes.map(() => 1) }],
  };
  if (adjusted) indicators.adjclose = [{ adjclose: adjusted }];
  return { timestamp: stamps, indicators };
}

describe("yahoo adjclose parser", () => {
  it("keeps the dividend-adjusted close when the chart close differs", () => {
    const day = 1_598_918_400;
    const parsed = adjustedClosesFromYahooChartResult(chart([124.81, 129.04], [120.9557, 125.0575], [day, day + 86_400]));
    assert.equal(parsed.ok, true);
    if (!parsed.ok) return;
    assert.deepEqual(parsed.bars.map((bar) => bar.adjClose), [120.9557, 125.0575]);
    assert.ok(parsed.bars.every((bar) => bar.adjClose < 126));
  });

  it("does not fall back to the chart close when adjclose is missing", () => {
    const parsed = adjustedClosesFromYahooChartResult(chart([200, 210], null, [1_700_000_000, 1_700_086_400]));
    assert.deepEqual(parsed, { ok: false, reason: "no-adjclose" });
  });

  it("rejects two stamps that land on the same date", () => {
    const parsed = adjustedClosesFromYahooChartResult(chart([10, 11], [10, 11], [1_700_000_000, 1_700_000_100]));
    assert.deepEqual(parsed, { ok: false, reason: "duplicate-date" });
  });
});

describe("adjusted series cache", () => {
  it("stores adjclose under its own key and leaves a raw price point untouched", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE price_points (provider TEXT, symbol TEXT, date TEXT, close REAL, PRIMARY KEY (provider, symbol, date));
      CREATE TABLE adjusted_return_points (provider TEXT, symbol TEXT, version TEXT, date TEXT, adj_close REAL, PRIMARY KEY (provider, symbol, version, date));
      CREATE TABLE adjusted_return_meta (provider TEXT, symbol TEXT, version TEXT, corporate_actions TEXT, source TEXT, fetched_at TEXT, latest_date TEXT, bar_count INTEGER, status TEXT, PRIMARY KEY (provider, symbol, version));
    `);
    db.prepare(`INSERT INTO price_points (provider, symbol, date, close) VALUES ('schwab', 'AAPL', '2020-08-28', 499.23)`).run();
    writeAdjustedSeries(db, "aapl", "ok", [{ date: "2020-08-28", adjClose: 120.9557 }, { date: "2020-08-31", adjClose: 125.0575 }], "2026-11-07T00:00:00.000Z");
    const stored = readAdjustedSeries(db, "AAPL");
    assert.equal(stored?.provider, "yahoo-adjusted");
    assert.equal(stored?.version, "yahoo-adjclose-v1");
    assert.equal(stored?.corporateActions, "yahoo-chart-v8-adjclose-splits-and-dividends");
    assert.equal(stored?.bars[0]?.adjClose, 120.9557);
    const raw = db.prepare(`SELECT close FROM price_points WHERE provider = 'schwab' AND symbol = 'AAPL'`).get() as { close: number };
    assert.equal(raw.close, 499.23);
    const yahooRaw = db.prepare(`SELECT COUNT(*) AS n FROM price_points WHERE provider = 'yahoo'`).get() as { n: number };
    assert.equal(yahooRaw.n, 0);
  });
});
