import assert from "node:assert/strict";
import { describe, it } from "node:test";

import {
  buildInternalPerformanceSeries,
  canonicalSymbol,
  cusipTickerMap,
  freshAccountIds,
  internalFillsFromStoredRow,
  latestShareSnapshotsByDay,
  mergeShareMarks,
  qualifyInternalUnderlyings,
  seedUnexplainedShareFills,
  shareClosesBySymbol,
  snapshotMarkPerShare,
  type InternalFill,
  type OpenHolding,
  type StoredBrokerFillRow,
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
    assert.deepEqual(built.audit.find((row) => row.symbol === "TSLA"), {
      symbol: "TSLA",
      pnl: 250,
      capital: 2000,
      returnPct: 12.5,
      stockPct: 20,
    });
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

  it("reads signed transferItems when instruction is null", () => {
    const bmnr = internalFillsFromStoredRow(
      realShapeRow({
        date: "2024-01-02",
        asset: "OPTION",
        effect: "OPENING",
        amount: -17,
        price: 2.32,
        symbol: "BMNR  261016P00028000",
        underlying: "BMNR",
        putCall: "PUT",
      }),
    );
    const pltr = internalFillsFromStoredRow(
      realShapeRow({
        date: "2024-01-02",
        asset: "OPTION",
        effect: "CLOSING",
        amount: 1,
        price: 42.55,
        symbol: "PLTR  281215C00290000",
        underlying: "PLTR",
        putCall: "CALL",
      }),
    );
    const qxo = internalFillsFromStoredRow(
      realShapeRow({
        date: "2024-01-10",
        asset: "EQUITY",
        effect: "CLOSING",
        amount: -4800,
        price: 12.32,
        symbol: "QXO",
      }),
    );
    const fund = internalFillsFromStoredRow(
      realShapeRow({
        date: "2024-01-02",
        asset: "MUTUAL_FUND",
        effect: "OPENING",
        amount: 25,
        price: 15,
        symbol: "SWPPX",
      }),
    );
    const collective = internalFillsFromStoredRow(
      realShapeRow({
        date: "2024-01-02",
        asset: "COLLECTIVE_INVESTMENT",
        effect: "OPENING",
        amount: 10,
        price: 20,
        symbol: "CTIVX",
      }),
    );
    assert.deepEqual(
      [bmnr[0], pltr[0], qxo[0], fund[0], collective[0]].map((fill) => [
        fill?.underlying,
        fill?.leg,
        fill?.signedShares,
        fill?.strike,
        fill?.price,
      ]),
      [
        ["BMNR", "put", -1700, 28, 2.32],
        ["PLTR", "call", 100, 290, 42.55],
        ["QXO", "share", -4800, null, 12.32],
        ["SWPPX", "share", 25, null, 15],
        ["CTIVX", "share", 10, null, 20],
      ],
    );
  });
});

describe("real Schwab row shape", () => {
  it("qualifies BMNR, PLTR, and TSLA synthetics plus seeded and fund shares", () => {
    const rows = [
      realShapeRow({
        date: "2024-01-02",
        asset: "OPTION",
        effect: "OPENING",
        amount: -17,
        price: 2.32,
        symbol: "BMNR  261016P00028000",
        underlying: "BMNR",
        putCall: "PUT",
      }),
      realShapeRow({
        date: "2024-01-02",
        asset: "OPTION",
        effect: "CLOSING",
        amount: 1,
        price: 42.55,
        symbol: "PLTR  281215C00290000",
        underlying: "PLTR",
        putCall: "CALL",
      }),
      realShapeRow({
        date: "2024-01-02",
        asset: "OPTION",
        effect: "OPENING",
        amount: -4,
        price: 3.1,
        symbol: "TSLA  261016P00200000",
        underlying: "TSLA",
        putCall: "PUT",
      }),
      realShapeRow({
        date: "2024-01-02",
        asset: "OPTION",
        effect: "OPENING",
        amount: -1,
        price: 1.1,
        symbol: "IWM   240719P00180000",
        underlying: "IWM",
        putCall: "PUT",
        extraLeg: {
          amount: -1,
          price: 1.4,
          symbol: "IWM   240719C00230000",
          underlying: "IWM",
          putCall: "CALL",
        },
      }),
      realShapeRow({
        date: "2024-06-03",
        asset: "EQUITY",
        effect: "CLOSING",
        amount: -4800,
        price: 12.32,
        symbol: "QXO",
      }),
      realShapeRow({
        date: "2024-01-02",
        asset: "MUTUAL_FUND",
        effect: "OPENING",
        amount: 25,
        price: 15,
        symbol: "SWPPX",
      }),
      realShapeRow({
        date: "2024-01-02",
        asset: "COLLECTIVE_INVESTMENT",
        effect: "OPENING",
        amount: 10,
        price: 20,
        symbol: "CTIVX",
      }),
    ];
    const fills = seedUnexplainedShareFills(
      rows.flatMap((row) => internalFillsFromStoredRow(row)),
      [{ accountId: "schwab_1", symbol: "QXO", date: "2024-01-02", quantity: 4800, price: 10 }],
    );
    assert.deepEqual(symbols(fills, "2024-07-02"), [
      "BMNR:synthetic",
      "CTIVX:shares",
      "PLTR:synthetic",
      "QXO:shares",
      "SWPPX:shares",
      "TSLA:synthetic",
    ]);
  });

  it("does not seed shares the blotter already explains", () => {
    const fills = seedUnexplainedShareFills([share("2024-01-02", 100, 10, "QXO")], [
      { accountId: "a", symbol: "QXO", date: "2024-01-02", quantity: 100, price: 10 },
    ]);
    assert.equal(fills.length, 1);
    assert.equal(fills[0]?.signedShares, 100);
  });

  it("seeds the share gap when the earliest snapshot is larger than the blotter", () => {
    const fills = seedUnexplainedShareFills([], [
      { accountId: "schwab_1", symbol: "QXO", date: "2024-01-02", quantity: 4800, price: 10 },
    ]);
    assert.equal(fills.length, 1);
    assert.equal(fills[0]?.signedShares, 4800);
    assert.equal(symbols(fills, "2024-01-03")[0], "QXO:shares");
  });
});

describe("current holdings and stock closes", () => {
  const pltrOpen: OpenHolding = {
    symbol: "PLTR",
    leg: "share",
    quantity: 100,
    strike: null,
    expiration: null,
    marketValue: 18629,
  };
  const closed: OpenHolding[] = [
    pltrOpen,
    { symbol: "TSLA", leg: "share", quantity: 10, strike: null, expiration: null, marketValue: 3741 },
  ];

  it("keeps names open on the latest snapshot and drops closed history", () => {
    const fills = [
      share("2024-01-02", 100, 10, "PLTR"),
      share("2024-01-02", 100, 10, "CLOV"),
      share("2024-02-01", -100, 12, "CLOV"),
      share("2024-01-02", 10, 20, "GME"),
    ];
    assert.deepEqual(
      qualifyInternalUnderlyings(fills, "2026-09-28", { start: "2026-05-08", end: "2026-09-28" }, closed).map(
        (row) => row.symbol,
      ),
      ["PLTR", "TSLA"],
    );
  });

  it("resolves a CUSIP to its ticker and drops an unresolved CUSIP", () => {
    const map = cusipTickerMap([
      { symbol: "67012U108", cusip: "67012U108", securityType: "equity" },
      { symbol: "NVDA", cusip: "67012U108", securityType: "equity" },
      { symbol: "82489T104", cusip: "82489T104", securityType: "equity" },
    ]);
    assert.equal(canonicalSymbol("67012U108", map), "NVDA");
    assert.equal(canonicalSymbol("82489T104", map), null);
    assert.equal(canonicalSymbol("PLTR", map), "PLTR");
    assert.equal(canonicalSymbol("G8251K115", map), null);
  });

  it("stock line is the Schwab close from the first chart date", () => {
    const closes = shareClosesBySymbol([
      { symbol: "PLTR", date: "2026-05-08", price: 14.06, provider: "yahoo" },
      { symbol: "PLTR", date: "2026-05-08T16:00:00Z", price: 137.8, provider: "schwab" },
      { symbol: "PLTR", date: "2026-08-28", price: 186.29, provider: "schwab" },
      { symbol: "PLTR", date: "2026-09-15", price: 14.06, provider: "yahoo" },
      { symbol: "TSLA", date: "2026-05-08", price: 428.35, provider: "schwab" },
      { symbol: "TSLA", date: "2026-09-21", price: 374.1, provider: "schwab" },
      { symbol: "GRAB", date: "2026-05-08", price: 5.2, provider: "schwab" },
      { symbol: "GRAB", date: "2026-08-28", price: 5, provider: "schwab" },
      { symbol: "GRAB", date: "2026-08-28", price: 3.1824, provider: "yahoo" },
      { symbol: "QXO", date: "2026-05-08", price: 18, provider: "schwab" },
      { symbol: "QXO", date: "2026-08-28", price: 17, provider: "schwab" },
      { symbol: "QXO", date: "2026-08-28", price: 11.826, provider: "other" },
    ]);
    const pltr = mergeShareMarks(closes.PLTR ?? [], [{ date: "2026-09-25", price: 190 }]);
    const fills = [
      share("2026-05-08", 100, 14.06, "PLTR"),
      share("2026-09-15", 1, 14.06, "PLTR"),
      share("2026-05-08", 10, 900, "TSLA"),
      share("2026-05-08", 100, 5, "GRAB"),
      share("2026-05-08", 100, 20, "QXO"),
    ];
    const open: OpenHolding[] = [
      pltrOpen,
      { symbol: "TSLA", leg: "share", quantity: 10, strike: null, expiration: null, marketValue: 3741 },
      { symbol: "GRAB", leg: "share", quantity: 100, strike: null, expiration: null, marketValue: 400 },
      { symbol: "QXO", leg: "share", quantity: 100, strike: null, expiration: null, marketValue: 1200 },
    ];
    const built = buildInternalPerformanceSeries(fills, {
      asOf: "2026-09-28",
      dates: ["2026-05-08", "2026-08-28", "2026-09-21", "2026-09-25", "2026-09-28"],
      sharePrices: {
        PLTR: pltr,
        TSLA: closes.TSLA ?? [],
        GRAB: closes.GRAB ?? [],
        QXO: closes.QXO ?? [],
      },
      openHoldings: open,
    });
    const pltrLine = built.bySymbol.PLTR;
    const tslaLine = built.bySymbol.TSLA;
    assert.equal(pltrLine?.find((point) => point.date === "2026-08-28")?.stockPct, 35.188679);
    assert.equal(pltrLine?.find((point) => point.date === "2026-09-25")?.stockPct, 37.880987);
    assert.equal(pltrLine?.find((point) => point.date === "2026-09-28")?.stockPct, 37.880987);
    assert.equal(tslaLine?.find((point) => point.date === "2026-09-21")?.stockPct, -12.664877);
    assert.equal(tslaLine?.find((point) => point.date === "2026-09-28")?.stockPct, null);
    assert.equal(built.bySymbol.GRAB?.find((point) => point.date === "2026-08-28")?.stockPct, -3.846154);
    assert.equal(built.bySymbol.QXO?.find((point) => point.date === "2026-08-28")?.stockPct, -5.555556);
  });

  it("stock line uses market value over quantity when the snapshot price is cost", () => {
    const mark = snapshotMarkPerShare({ quantity: 12500, marketValue: 2367500 });
    assert.equal(mark, 189.4);
    const fromMetadata = snapshotMarkPerShare({
      quantity: 12500,
      marketValue: null,
      metadataJson: JSON.stringify({
        averagePrice: 14.11783,
        marketValue: 2367500,
        longQuantity: 12500,
      }),
    });
    assert.equal(fromMetadata, 189.4);
    const closes = shareClosesBySymbol([{ symbol: "PLTR", date: "2026-05-08", price: 137.8, provider: "schwab" }]);
    const merged = mergeShareMarks(closes.PLTR ?? [], [{ date: "2026-09-28", price: mark! }]);
    const built = buildInternalPerformanceSeries([share("2026-05-08", 12500, 14.11783, "PLTR")], {
      asOf: "2026-09-28",
      dates: ["2026-05-08", "2026-08-28", "2026-09-28"],
      sharePrices: { PLTR: merged },
      openHoldings: [
        { symbol: "PLTR", leg: "share", quantity: 12500, strike: null, expiration: null, marketValue: 2367500 },
      ],
    });
    const line = built.bySymbol.PLTR;
    assert.equal(line?.find((point) => point.date === "2026-08-28")?.stockPct, null);
    assert.equal(line?.find((point) => point.date === "2026-09-28")?.stockPct, 37.445573);
  });

  it("drops an account whose last snapshot is stale", () => {
    const fresh = freshAccountIds([
      { accountId: "schwab_99113937", lastSnapshot: "2026-09-28" },
      { accountId: "schwab_51115831", lastSnapshot: "2026-05-08" },
      { accountId: "manual_10b6", lastSnapshot: "2026-09-23" },
    ]);
    assert.deepEqual([...fresh].sort(), ["manual_10b6", "schwab_99113937"]);
  });

  it("window pnl is the mark change when older cost and same-day snapshots repeat", () => {
    const snaps = [
      { accountId: "a", symbol: "PLTR", date: "2024-06-03", asOf: "2024-06-03T01:00:14Z", quantity: 100, price: 10 },
      { accountId: "a", symbol: "PLTR", date: "2024-06-03", asOf: "2024-06-03T01:10:14Z", quantity: 100, price: 10 },
      { accountId: "a", symbol: "PLTR", date: "2024-07-01", asOf: "2024-07-01T01:00:14Z", quantity: 100, price: 10 },
      { accountId: "a", symbol: "PLTR", date: "2024-07-01", asOf: "2024-07-01T01:10:14Z", quantity: 100, price: 10 },
    ];
    assert.equal(latestShareSnapshotsByDay(snaps).filter((row) => row.date === "2024-06-03")[0]?.quantity, 100);
    const built = buildInternalPerformanceSeries([share("2024-01-02", 100, 10, "PLTR")], {
      asOf: "2024-07-01",
      dates: ["2024-06-03", "2024-07-01"],
      sharePrices: {
        PLTR: [
          { date: "2024-06-03", price: 50 },
          { date: "2024-07-01", price: 80 },
        ],
      },
      shareSnapshots: snaps,
      openHoldings: [
        { symbol: "PLTR", leg: "share", quantity: 100, strike: null, expiration: null, marketValue: 8000 },
      ],
    });
    const end = built.bySymbol.PLTR?.[1];
    assert.equal(built.audit.find((row) => row.symbol === "PLTR")?.pnl, 3000);
    assert.equal(end?.stockPct, 60);
    assert.equal(end?.returnPct, end?.stockPct);
  });

  it("keeps a shares-only return on the stock line when the lot is seeded inside the window", () => {
    const seeded = seedUnexplainedShareFills(
      [],
      [{ accountId: "a", symbol: "RKLB", date: "2024-07-01", quantity: 56, price: 300 }],
    );
    const built = buildInternalPerformanceSeries(seeded, {
      asOf: "2024-07-01",
      dates: ["2024-06-03", "2024-07-01"],
      sharePrices: {
        RKLB: [
          { date: "2024-06-03", price: 100 },
          { date: "2024-07-01", price: 60 },
        ],
      },
      shareSnapshots: [
        { accountId: "a", symbol: "RKLB", date: "2024-07-01", asOf: "2024-07-01T01:00:14Z", quantity: 56, price: 300 },
        { accountId: "a", symbol: "RKLB", date: "2024-07-01", asOf: "2024-07-01T01:10:14Z", quantity: 56, price: 300 },
      ],
      openHoldings: [
        { symbol: "RKLB", leg: "share", quantity: 56, strike: null, expiration: null, marketValue: 3360 },
      ],
    });
    const end = built.bySymbol.RKLB?.[1];
    assert.equal(built.audit.find((row) => row.symbol === "RKLB")?.pnl, -2240);
    assert.ok((end?.returnPct ?? 0) < 0);
    assert.equal(end?.returnPct, end?.stockPct);
  });

  it("back-derives shares already held when the only snapshot is after the window start", () => {
    const start = 416;
    const end = 371.75;
    const buyCost = 347.39 + 362;
    const snaps = [
      { accountId: "a", symbol: "TSLA", date: "2026-09-28", asOf: "2026-09-28T01:00:14Z", quantity: 5, price: 250 },
    ];
    const built = buildInternalPerformanceSeries(
      seedUnexplainedShareFills(
        [share("2026-08-19", 1, 347.39, "TSLA"), share("2026-08-31", 1, 362, "TSLA")],
        snaps,
      ),
      {
        asOf: "2026-09-28",
        dates: ["2026-06-01", "2026-09-28"],
        sharePrices: {
          TSLA: [
            { date: "2026-06-01", price: start },
            { date: "2026-09-28", price: end },
          ],
        },
        shareSnapshots: snaps,
        openHoldings: [
          { symbol: "TSLA", leg: "share", quantity: 5, strike: null, expiration: null, marketValue: 5 * end },
        ],
      },
    );
    const audit = built.audit.find((row) => row.symbol === "TSLA");
    assert.equal(audit?.pnl, Math.round((5 * end - 3 * start - buyCost) * 100) / 100);
    assert.equal(audit?.capital, Math.round((3 * start + buyCost) * 100) / 100);
  });

  it("measures a long book's giveback against the value at the chart start", () => {
    const built = buildInternalPerformanceSeries([share("2024-01-02", 100, 10, "VSCPX")], {
      asOf: "2024-07-01",
      dates: ["2024-06-03", "2024-07-01"],
      sharePrices: {
        VSCPX: [
          { date: "2024-06-03", price: 36 },
          { date: "2024-07-01", price: 1 },
        ],
      },
    });
    assert.equal(built.bySymbol.VSCPX?.[1]?.returnPct, -97.222222);
    assert.equal(built.audit.find((row) => row.symbol === "VSCPX")?.capital, 3600);
  });

  it("qualifies a snapshot synthetic only when the current episode exceeds 180 days", () => {
    const shortPut = (underlying: string): OpenHolding => ({
      symbol: underlying,
      leg: "put",
      quantity: -1700,
      strike: 28,
      expiration: "2026-10-16",
      marketValue: 3000,
    });
    const fills = [
      opt("2024-01-02", "BMNR", "put", 28, -1700, 2.32, "2026-10-16"),
      opt("2026-09-01", "CLOV", "put", 28, -100, 1, "2026-10-16"),
    ];
    const names = qualifyInternalUnderlyings(fills, "2026-09-28", undefined, [shortPut("BMNR"), shortPut("CLOV")]).map(
      (row) => `${row.symbol}:${row.reason}`,
    );
    assert.deepEqual(names, ["BMNR:synthetic"]);
  });
});

function realShapeRow(input: {
  date: string;
  asset: string;
  effect: "OPENING" | "CLOSING";
  amount: number;
  price: number;
  symbol: string;
  underlying?: string;
  putCall?: string;
  extraLeg?: { amount: number; price: number; symbol: string; underlying: string; putCall: string };
}): StoredBrokerFillRow {
  const leg = (part: {
    amount: number;
    price: number;
    symbol: string;
    underlying?: string;
    putCall?: string;
  }) => ({
    positionEffect: input.effect,
    amount: part.amount,
    price: part.price,
    instrument: {
      assetType: input.asset,
      symbol: part.symbol,
      underlyingSymbol: part.underlying,
      putCall: part.putCall,
    },
  });
  const security = leg(input);
  const items = [
    { feeType: "COMMISSION", amount: -0.65, instrument: { assetType: "CURRENCY", symbol: "CURRENCY_USD" } },
    security,
  ];
  if (input.extraLeg) items.push(leg(input.extraLeg));
  return {
    account_id: "schwab_1",
    trade_date: input.date,
    transaction_type: "TRADE",
    raw_json: JSON.stringify({ type: "TRADE", transferItems: items }),
    symbol: input.symbol,
    underlying_symbol: input.underlying ?? null,
    asset_type: input.asset,
    instruction: null,
    position_effect: input.effect,
    quantity: input.amount,
    price: input.price,
    option_expiration: null,
    option_right: null,
    option_strike: null,
  };
}
