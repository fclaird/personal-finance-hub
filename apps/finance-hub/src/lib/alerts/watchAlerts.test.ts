import assert from "node:assert/strict";
import { describe, it } from "node:test";

import Database from "better-sqlite3";

import { onAlertNotice } from "@/lib/alerts/notify";
import { localNoticeCopy } from "@/lib/alerts/localNotice";
import { evaluateWatchAlerts, pnlBySpread, pnlByUnderlying, type WatchAlert } from "@/lib/alerts/watchAlerts";
import { insertWatchAlert, listWatchAlerts, runWatchAlerts } from "@/lib/alerts/watchAlertStore";
import { assembleMonitorRows } from "@/lib/alerts/watchMonitor";

const price: WatchAlert = {
  id: "a1",
  kind: "price",
  symbol: "now",
  enabled: true,
  config: { direction: "above", level: 150 },
};

describe("watch alerts", () => {
  it("fires a price, IV rank, and profit target only when the line is crossed", () => {
    const alerts: WatchAlert[] = [
      price,
      { id: "a2", kind: "price", symbol: "AAPL", enabled: true, config: { direction: "below", level: 100 } },
      { id: "a3", kind: "iv-spike", symbol: "NOW", enabled: true, config: { minRankPct: 80 } },
      { id: "a4", kind: "profit-target", symbol: "NOW", enabled: true, config: { targetPnl: 500 } },
      { id: "a5", kind: "price", symbol: "MSFT", enabled: false, config: { direction: "above", level: 1 } },
      { id: "a6", kind: "iv-spike", symbol: "QQQ", enabled: true, config: { minRankPct: 50 } },
    ];
    const titles = evaluateWatchAlerts(
      alerts,
      [
        { symbol: "NOW", last: 151, ivRankPct: 82 },
        { symbol: "AAPL", last: 120, ivRankPct: null },
        { symbol: "QQQ", last: 400, ivRankPct: null },
      ],
      [{ symbol: "NOW", pnl: 640 }],
    ).map((row) => row.title);
    assert.deepEqual(titles, ["NOW at or above 150", "NOW IV rank 82% is at least 80%", "NOW open P&L 640.00 reached 500"]);
  });

  it("prices equity from the quote and options from average price and market value", () => {
    const rows = pnlByUnderlying([
      { underlying: "NOW", securityType: "equity", quantity: 10, averagePrice: 100, marketValue: null, quote: 110 },
      { underlying: "NOW", securityType: "option", quantity: 1, averagePrice: 5, marketValue: 800, quote: null },
      { underlying: "XYZ", securityType: "option", quantity: -1, averagePrice: 2, marketValue: null, quote: 1 },
    ]);
    const now = rows.find((row) => row.symbol === "NOW");
    assert.equal(now?.pnl, 10 * 10 + (800 - 500));
    assert.equal(rows.find((row) => row.symbol === "XYZ")?.pnl, null);
  });

  it("prices a spread from the legs that share an expiry and ignores the rest of the name", () => {
    const spreads = pnlBySpread([
      { underlying: "NOW", securityType: "option", quantity: 1, averagePrice: 2, marketValue: 450, quote: null, expiry: "2026-11-20" },
      { underlying: "NOW", securityType: "option", quantity: -1, averagePrice: 1, marketValue: -80, quote: null, expiry: "2026-11-20" },
      { underlying: "NOW", securityType: "option", quantity: 1, averagePrice: 4, marketValue: 900, quote: null, expiry: "2027-01-15" },
      { underlying: "NOW", securityType: "equity", quantity: 10, averagePrice: 100, marketValue: 1200, quote: 110, expiry: null },
    ]);
    assert.deepEqual(
      spreads.map((row) => [row.expiry, row.pnl]),
      [
        ["2026-11-20", 450 - 200 + (-80 - -100)],
        ["2027-01-15", 900 - 400],
      ],
    );
    const titles = evaluateWatchAlerts(
      [
        { id: "s1", kind: "profit-target", symbol: "NOW", enabled: true, config: { targetPnl: 200, expiry: "2026-11-20" } },
        { id: "s2", kind: "profit-target", symbol: "NOW", enabled: true, config: { targetPnl: 200, expiry: "2027-06-18" } },
      ],
      [],
      [{ symbol: "NOW", pnl: 5000 }],
      spreads,
    ).map((row) => row.title);
    assert.deepEqual(titles, ["NOW 2026-11-20 spread P&L 270.00 reached 200"]);
    assert.equal(localNoticeCopy({ title: titles[0]!, symbol: "NOW" }).body, "NOW · Financial Bridge");
  });

  it("stores an alert, writes one in-app event per day, and calls the notice hook", () => {
    const db = new Database(":memory:");
    db.exec(`
      CREATE TABLE alert_rules (
        id TEXT PRIMARY KEY,
        type TEXT NOT NULL,
        config_json TEXT NOT NULL,
        enabled INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        updated_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
      CREATE TABLE alert_events (
        id TEXT PRIMARY KEY,
        rule_id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        severity TEXT NOT NULL,
        title TEXT NOT NULL,
        details_json TEXT
      );
    `);
    const saved = insertWatchAlert(db, { kind: "price", symbol: "now", config: { direction: "above", level: 140 } });
    assert.equal(saved?.symbol, "NOW");
    assert.equal(listWatchAlerts(db).length, 1);
    const seen: string[] = [];
    const stop = onAlertNotice((notice) => seen.push(notice.title));
    const first = runWatchAlerts(db, [{ symbol: "NOW", last: 141, ivRankPct: null }], []);
    const second = runWatchAlerts(db, [{ symbol: "NOW", last: 142, ivRankPct: null }], []);
    stop();
    assert.equal(first.created, 1);
    assert.equal(second.created, 0);
    assert.deepEqual(seen, ["NOW at or above 140"]);
    const count = db.prepare(`SELECT COUNT(*) AS n FROM alert_events`).get() as { n: number };
    assert.equal(count.n, 1);
  });

  it("lines the board up by symbol and leaves missing quotes blank", () => {
    const rows = assembleMonitorRows(
      ["aapl", "NOW"],
      [{ symbol: "NOW", last: 140, change: 1.5, changePercent: 0.01, volume: 1000 }],
      new Map([["NOW", 42]]),
      new Map([["NOW", 0.35]]),
    );
    assert.deepEqual(
      rows.map((row) => row.symbol),
      ["AAPL", "NOW"],
    );
    assert.equal(rows[0]?.last, null);
    assert.equal(rows[1]?.ivRankPct, 42);
    assert.equal(rows[1]?.atmIv, 0.35);
    assert.equal(rows[1]?.change, 1.5);
  });
});
