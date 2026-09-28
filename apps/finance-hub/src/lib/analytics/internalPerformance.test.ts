import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildInternalPerformanceSeries,
  internalFillsFromStoredRow,
  qualifyInternalUnderlyings,
  type InternalFill,
} from "@/lib/analytics/internalPerformance";

const EXP = "2024-12-19";

function share(date: string, qty: number, price: number, underlying = "AAA"): InternalFill {
  return {
    accountId: "a",
    date,
    underlying,
    leg: "share",
    signedShares: qty,
    price,
    strike: null,
    expiration: null,
  };
}

function opt(
  date: string,
  underlying: string,
  leg: "call" | "put",
  strike: number,
  signedShares: number,
  price: number,
  expiration = EXP,
): InternalFill {
  return { accountId: "a", date, underlying, leg, signedShares, price, strike, expiration };
}

function symbols(fills: InternalFill[], asOf: string, window?: { start: string; end: string }) {
  return qualifyInternalUnderlyings(fills, asOf, window).map((row) => `${row.symbol}:${row.reason}`);
}

describe("internal performance qualification", () => {
  it("includes a stock held for a few days and excludes a short-dated short put", () => {
    const stock = [share("2024-01-02", 100, 10)];
    const put = [opt("2024-01-02", "BBB", "put", 10, -100, 1)];
    assert.deepEqual(symbols(stock, "2024-01-12"), ["AAA:shares"]);
    assert.deepEqual(symbols(put, "2024-01-12"), []);
  });

  it("qualifies a short put once the calendar span is more than 180 days", () => {
    const put = [opt("2024-01-02", "PLTR", "put", 20, -100, 1)];
    assert.deepEqual(symbols(put, "2024-06-30"), []);
    assert.deepEqual(symbols(put, "2024-07-01"), ["PLTR:synthetic"]);
  });

  it("keeps one synthetic clock across a gap of four trading days", () => {
    const fills = [
      opt("2024-01-02", "TSLA", "put", 100, -100, 2),
      opt("2024-04-01", "TSLA", "put", 100, 100, 2),
      opt("2024-04-08", "TSLA", "put", 90, -100, 1.5, "2024-07-19"),
    ];
    assert.deepEqual(symbols(fills, "2024-07-02"), ["TSLA:synthetic"]);
  });

  it("resets the synthetic clock when the flat gap is five trading days", () => {
    const fills = [
      opt("2024-01-02", "TSLA", "put", 100, -100, 2),
      opt("2024-04-01", "TSLA", "put", 100, 100, 2),
      opt("2024-04-09", "TSLA", "put", 90, -100, 1.5, "2024-07-19"),
    ];
    assert.deepEqual(symbols(fills, "2024-07-02"), []);
  });

  it("excludes a strangle, a vertical, a butterfly, a naked short call, and a lone long put", () => {
    const asOf = "2024-07-02";
    const strangle = [
      opt("2024-01-02", "STR", "put", 90, -100, 1),
      opt("2024-01-02", "STR", "call", 110, -100, 1),
    ];
    const vertical = [
      opt("2024-01-02", "VER", "call", 100, 100, 3),
      opt("2024-01-02", "VER", "call", 110, -100, 1, EXP),
    ];
    const butterfly = [
      opt("2024-01-02", "FLY", "call", 90, 100, 4),
      opt("2024-01-02", "FLY", "call", 100, -200, 2),
      opt("2024-01-02", "FLY", "call", 110, 100, 1),
    ];
    const nakedCall = [opt("2024-01-02", "NAK", "call", 100, -100, 1)];
    const longPut = [opt("2024-01-02", "LNG", "put", 100, 100, 1)];
    assert.deepEqual(symbols([...strangle, ...vertical, ...butterfly, ...nakedCall, ...longPut], asOf), []);
  });

  it("qualifies a long call plus short put with no shares", () => {
    const fills = [
      opt("2024-01-02", "BMNR", "call", 30, 100, 5),
      opt("2024-01-02", "BMNR", "put", 30, -100, 4),
    ];
    assert.deepEqual(symbols(fills, "2024-07-02"), ["BMNR:synthetic"]);
  });

  it("drops a closed stock that does not overlap the chart window", () => {
    const fills = [share("2024-01-02", 100, 10), share("2024-01-10", -100, 11)];
    assert.deepEqual(symbols(fills, "2024-07-02", { start: "2024-07-01", end: "2024-07-02" }), []);
    assert.deepEqual(symbols([share("2024-01-02", 100, 10)], "2024-07-02", { start: "2024-07-01", end: "2024-07-02" }), [
      "AAA:shares",
    ]);
  });
});

describe("internal performance return", () => {
  it("combines shares, a rolled put ladder, and collected premium on one line", () => {
    const fills = [
      share("2024-01-02", 100, 10, "BMNR"),
      opt("2024-01-02", "BMNR", "put", 10, -100, 2, "2024-04-19"),
      opt("2024-04-01", "BMNR", "put", 10, 100, 0.5, "2024-04-19"),
      opt("2024-04-01", "BMNR", "put", 9, -100, 1.5, "2024-07-19"),
    ];
    const built = buildInternalPerformanceSeries(fills, {
      asOf: "2024-07-02",
      dates: ["2024-01-02", "2024-07-02"],
      sharePrices: {
        BMNR: [
          { date: "2024-01-02", price: 10 },
          { date: "2024-07-02", price: 10 },
        ],
      },
      optionMarks: [
        { underlying: "BMNR", right: "P", strike: 9, expiration: "2024-07-19", date: "2024-07-02", price: 1.5 },
      ],
    });
    assert.deepEqual(
      built.symbols.map((row) => row.symbol),
      ["BMNR"],
    );
    assert.equal(built.symbols[0]?.reason, "both");
    const line = built.bySymbol.BMNR;
    assert.equal(line?.[0]?.returnPct, 0);
    assert.equal(line?.[1]?.returnPct, 7.5);
    assert.equal(line?.[1]?.stockPct, 0);
  });

  it("divides share profit and short-put profit by share cost plus full put collateral", () => {
    const fills = [
      share("2024-01-02", 100, 10, "TSLA"),
      opt("2024-01-02", "TSLA", "put", 10, -100, 1),
    ];
    const built = buildInternalPerformanceSeries(fills, {
      asOf: "2024-07-03",
      dates: ["2024-01-02", "2024-07-03"],
      sharePrices: {
        TSLA: [
          { date: "2024-01-02", price: 10 },
          { date: "2024-07-03", price: 12 },
        ],
      },
      optionMarks: [{ underlying: "TSLA", right: "P", strike: 10, expiration: EXP, date: "2024-07-03", price: 0.5 }],
    });
    const line = built.bySymbol.TSLA;
    assert.equal(built.symbols[0]?.reason, "both");
    assert.equal(line?.[0]?.returnPct, 0);
    assert.equal(line?.[1]?.returnPct, 12.5);
    assert.equal(line?.[1]?.stockPct, 20);
  });

  it("keeps each account's share lots separate", () => {
    const fills = [
      { ...share("2024-01-02", 100, 10), accountId: "a" },
      { ...share("2024-01-03", -100, 20), accountId: "b" },
    ];
    const built = buildInternalPerformanceSeries(fills, {
      asOf: "2024-01-03",
      dates: ["2024-01-02", "2024-01-03"],
      sharePrices: {
        AAA: [
          { date: "2024-01-02", price: 10 },
          { date: "2024-01-03", price: 10 },
        ],
      },
    });
    assert.equal(built.bySymbol.AAA?.[1]?.returnPct, 0);
  });

  it("leaves a same-expiration strangle out of a stock line", () => {
    const fills = [
      share("2024-01-02", 100, 10, "QQQ"),
      opt("2024-01-02", "QQQ", "put", 50, -100, 3),
      opt("2024-01-02", "QQQ", "call", 60, -100, 3),
    ];
    const built = buildInternalPerformanceSeries(fills, {
      asOf: "2024-01-03",
      dates: ["2024-01-02", "2024-01-03"],
      sharePrices: {
        QQQ: [
          { date: "2024-01-02", price: 10 },
          { date: "2024-01-03", price: 12 },
        ],
      },
    });
    assert.equal(built.symbols[0]?.reason, "shares");
    assert.equal(built.bySymbol.QQQ?.[1]?.returnPct, 20);
    assert.equal(Object.keys(built.bySymbol).length, 1);
  });
});

describe("internal fills from broker rows", () => {
  it("expands both legs of one strangle order", () => {
    const fills = internalFillsFromStoredRow({
      account_id: "schwab_1",
      trade_date: "2024-03-01",
      transaction_type: "TRADE",
      raw_json: JSON.stringify({
        type: "TRADE",
        transactionItem: [
          {
            instruction: "SELL_TO_OPEN",
            positionEffect: "OPENING",
            quantity: 1,
            price: 1.2,
            instrument: { assetType: "OPTION", symbol: "PLTR  240419P00020000", underlyingSymbol: "PLTR" },
          },
          {
            instruction: "SELL_TO_OPEN",
            positionEffect: "OPENING",
            quantity: 1,
            price: 1.4,
            instrument: { assetType: "OPTION", symbol: "PLTR  240419C00030000", underlyingSymbol: "PLTR" },
          },
        ],
      }),
      symbol: "PLTR  240419P00020000",
      underlying_symbol: "PLTR",
      asset_type: "OPTION",
      instruction: "SELL_TO_OPEN",
      position_effect: "OPENING",
      quantity: 1,
      price: 1.2,
      option_expiration: "2024-04-19",
      option_right: "P",
      option_strike: 20,
    });
    assert.deepEqual(
      fills.map((fill) => [fill.leg, fill.signedShares, fill.strike, fill.price]),
      [
        ["put", -100, 20, 1.2],
        ["call", -100, 30, 1.4],
      ],
    );
  });
});
