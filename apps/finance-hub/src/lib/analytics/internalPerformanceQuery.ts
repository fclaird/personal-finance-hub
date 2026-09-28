import type Database from "better-sqlite3";

import {
  filterSeriesFromBaseline,
  getGlanceAlignedPortfolioValueSeriesByBucket,
  mergeMissingSnapshotDays,
  resolvePerformanceTrackingBaselineYmd,
} from "@/lib/analytics/glanceAlignedPerformance";
import {
  INTERNAL_DEFAULT_ON_LIMIT,
  buildInternalPerformanceSeries,
  canonicalSymbol,
  cusipTickerMap,
  internalFillsFromStoredRow,
  mergeShareMarks,
  seedUnexplainedShareFills,
  shareClosesBySymbol,
  type InternalAudit,
  type InternalFill,
  type OpenHolding,
  type QualifyReason,
  type ShareHoldingSnapshot,
  type SharePricePoint,
  type StoredBrokerFillRow,
} from "@/lib/analytics/internalPerformance";
import { bucketFromAccount, type AccountBucket } from "@/lib/accountBuckets";
import type { FlavorId } from "@/lib/flavor";
import { nyYmd } from "@/lib/market/usEquitySession";
import {
  chartDataFromDenseSeries,
  collapseToTradingDays,
  extendChartDataThroughNow,
} from "@/lib/portfolio/snapshots";
import { parseOptionFromSchwabSymbol } from "@/lib/strategy/optionParse";
import { strategyTradesAccountWhereSql } from "@/lib/strategy/strategyTradesScope";

const POSITION_COLORS = [
  "#2563eb",
  "#dc2626",
  "#d97706",
  "#7c3aed",
  "#db2777",
  "#059669",
  "#ea580c",
  "#4f46e5",
  "#be123c",
  "#0e7490",
];

export type InternalPerformanceBucket = "combined" | "retirement" | "brokerage";

export type InternalPerformanceChart = {
  symbols: Array<{ symbol: string; reason: QualifyReason; color: string; defaultOn: boolean; marketValue: number }>;
  audit: InternalAudit[];
  chart_data: Array<{
    date: string;
    seq_index: number;
    portfolio: number | null;
    positions: Record<string, number | null>;
    stocks: Record<string, number | null>;
  }>;
};

type AccountRow = StoredBrokerFillRow & {
  account_name: string;
  account_nickname: string | null;
  account_bucket: string | null;
};

function accountInBucket(
  bucket: InternalPerformanceBucket,
  name: string,
  nickname: string | null,
  accountBucket: string | null,
): boolean {
  if (bucket === "combined") return true;
  return bucketFromAccount(name, nickname, accountBucket) === (bucket as AccountBucket);
}

function snapshotUnitPrice(price: number | null, quantity: number, marketValue: number | null): number | null {
  if (price != null && price > 0) return price;
  if (marketValue == null || quantity === 0) return null;
  const perShare = Math.abs(marketValue / quantity);
  return perShare > 0 && Number.isFinite(perShare) ? perShare : null;
}

function earliestShareSnapshots(
  db: Database.Database,
  flavor: FlavorId,
  bucket: InternalPerformanceBucket,
): ShareHoldingSnapshot[] {
  const accountWhere = strategyTradesAccountWhereSql(flavor, "a");
  const rows = db
    .prepare(
      `
      SELECT hs.account_id AS account_id,
             substr(hs.as_of, 1, 10) AS date,
             UPPER(TRIM(sec.symbol)) AS symbol,
             p.quantity AS quantity,
             p.price AS price,
             p.market_value AS market_value,
             a.name AS account_name,
             a.nickname AS account_nickname,
             a.account_bucket AS account_bucket
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities sec ON sec.id = p.security_id
      WHERE sec.security_type != 'option'
        AND sec.security_type != 'cash'
        AND sec.symbol IS NOT NULL
        AND TRIM(sec.symbol) != ''
        AND ${accountWhere}
      ORDER BY hs.as_of ASC, p.id ASC
    `,
    )
    .all() as Array<{
    account_id: string;
    date: string;
    symbol: string;
    quantity: number;
    price: number | null;
    market_value: number | null;
    account_name: string;
    account_nickname: string | null;
    account_bucket: string | null;
  }>;

  const earliest = new Map<string, ShareHoldingSnapshot>();
  for (const row of rows) {
    if (!accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket)) continue;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(row.date) || !row.symbol) continue;
    const key = `${row.account_id}|${row.symbol}`;
    const price = snapshotUnitPrice(row.price, row.quantity, row.market_value);
    const prev = earliest.get(key);
    if (!prev) {
      earliest.set(key, {
        accountId: row.account_id,
        symbol: row.symbol,
        date: row.date,
        quantity: row.quantity,
        price,
      });
      continue;
    }
    if (row.date > prev.date) continue;
    prev.quantity += row.quantity;
    if (!(prev.price != null && prev.price > 0) && price != null) prev.price = price;
  }
  return [...earliest.values()];
}

function portfolioRows(db: Database.Database, flavor: FlavorId, bucket: InternalPerformanceBucket, now: Date) {
  const snapshots =
    flavor === "main"
      ? (db
          .prepare(
            `SELECT snapshot_date, total_value FROM portfolio_snapshots WHERE bucket = ? ORDER BY snapshot_date ASC`,
          )
          .all(bucket) as Array<{ snapshot_date: string; total_value: number }>)
      : [];
  const denseAll = mergeMissingSnapshotDays(getGlanceAlignedPortfolioValueSeriesByBucket(bucket, db, flavor), snapshots);
  const tradingAll = collapseToTradingDays(denseAll);
  const { baselineYmd } = resolvePerformanceTrackingBaselineYmd(tradingAll, now);
  const trading = filterSeriesFromBaseline(tradingAll, baselineYmd);
  if (trading.length === 0) return [];
  return extendChartDataThroughNow(chartDataFromDenseSeries(trading, [], []), [], [], now.getTime());
}

function tickerByCusip(db: Database.Database): Map<string, string> {
  const rows = db
    .prepare(
      `
      SELECT UPPER(TRIM(symbol)) AS symbol,
             UPPER(TRIM(cusip)) AS cusip,
             security_type AS security_type
      FROM securities
      WHERE cusip IS NOT NULL AND TRIM(cusip) != ''
        AND symbol IS NOT NULL AND TRIM(symbol) != ''
    `,
    )
    .all() as Array<{ symbol: string; cusip: string; security_type: string | null }>;
  return cusipTickerMap(rows.map((row) => ({ symbol: row.symbol, cusip: row.cusip, securityType: row.security_type })));
}

function remapFills(fills: InternalFill[], cusips: Map<string, string>): InternalFill[] {
  const out: InternalFill[] = [];
  for (const fill of fills) {
    const symbol = canonicalSymbol(fill.underlying, cusips);
    if (!symbol) continue;
    out.push(symbol === fill.underlying ? fill : { ...fill, underlying: symbol });
  }
  return out;
}

function latestOpenHoldings(db: Database.Database, flavor: FlavorId, bucket: InternalPerformanceBucket, cusips: Map<string, string>): OpenHolding[] {
  const accountWhere = strategyTradesAccountWhereSql(flavor, "a");
  const rows = db
    .prepare(
      `
      SELECT UPPER(TRIM(sec.symbol)) AS symbol,
             sec.security_type AS security_type,
             sec.expiration_date AS expiration,
             sec.strike_price AS strike,
             sec.option_type AS option_type,
             UPPER(COALESCE(NULLIF(TRIM(us.symbol), ''), '')) AS underlying,
             p.quantity AS quantity,
             p.price AS price,
             p.market_value AS market_value,
             a.name AS account_name,
             a.nickname AS account_nickname,
             a.account_bucket AS account_bucket
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities sec ON sec.id = p.security_id
      LEFT JOIN securities us ON us.id = sec.underlying_security_id
      JOIN (
        SELECT account_id, MAX(as_of) AS max_as_of
        FROM holding_snapshots
        GROUP BY account_id
      ) latest ON latest.account_id = hs.account_id AND latest.max_as_of = hs.as_of
      WHERE sec.security_type != 'cash'
        AND ${accountWhere}
    `,
    )
    .all() as Array<{
    symbol: string;
    security_type: string;
    expiration: string | null;
    strike: number | null;
    option_type: string | null;
    underlying: string;
    quantity: number;
    price: number | null;
    market_value: number | null;
    account_name: string;
    account_nickname: string | null;
    account_bucket: string | null;
  }>;

  const out: OpenHolding[] = [];
  for (const row of rows) {
    if (!accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket)) continue;
    if (!Number.isFinite(row.quantity) || Math.abs(row.quantity) < 1e-9) continue;
    const parsed = parseOptionFromSchwabSymbol(row.symbol);
    const isOption = row.security_type === "option" || parsed != null;
    const marketValue =
      row.market_value != null && Number.isFinite(row.market_value)
        ? Math.abs(row.market_value)
        : row.price != null && row.price > 0
          ? Math.abs(row.price * row.quantity) * (isOption ? 100 : 1)
          : 0;
    if (!isOption) {
      if (row.quantity <= 0) continue;
      const symbol = canonicalSymbol(row.symbol, cusips);
      if (!symbol) continue;
      out.push({
        symbol,
        leg: "share",
        quantity: row.quantity,
        strike: null,
        expiration: null,
        marketValue,
      });
      continue;
    }
    const type = (row.option_type ?? "").toUpperCase();
    const right = parsed?.right ?? (type.startsWith("P") ? "P" : type.startsWith("C") ? "C" : null);
    const strike = parsed?.strike ?? row.strike;
    const expiration = parsed?.expiration ?? row.expiration?.slice(0, 10) ?? null;
    const underlying = canonicalSymbol(row.underlying || parsed?.underlying || "", cusips);
    if (!right || strike == null || !expiration || !underlying) continue;
    out.push({
      symbol: underlying,
      leg: right === "P" ? "put" : "call",
      quantity: row.quantity * 100,
      strike,
      expiration,
      marketValue,
    });
  }
  return out;
}

function snapshotShareMarks(
  db: Database.Database,
  flavor: FlavorId,
  bucket: InternalPerformanceBucket,
  cusips: Map<string, string>,
): Record<string, SharePricePoint[]> {
  const accountWhere = strategyTradesAccountWhereSql(flavor, "a");
  const rows = db
    .prepare(
      `
      SELECT substr(hs.as_of, 1, 10) AS date,
             hs.as_of AS as_of,
             UPPER(TRIM(sec.symbol)) AS symbol,
             p.quantity AS quantity,
             p.price AS price,
             p.market_value AS market_value,
             a.name AS account_name,
             a.nickname AS account_nickname,
             a.account_bucket AS account_bucket
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities sec ON sec.id = p.security_id
      WHERE sec.security_type != 'option'
        AND sec.security_type != 'cash'
        AND p.quantity > 0
        AND ${accountWhere}
      ORDER BY hs.as_of ASC
    `,
    )
    .all() as Array<{
    date: string;
    as_of: string;
    symbol: string;
    quantity: number;
    price: number | null;
    market_value: number | null;
    account_name: string;
    account_nickname: string | null;
    account_bucket: string | null;
  }>;

  const latest = new Map<string, SharePricePoint & { asOf: string }>();
  for (const row of rows) {
    if (!accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket)) continue;
    const symbol = canonicalSymbol(row.symbol, cusips);
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const price = snapshotUnitPrice(row.price, row.quantity, row.market_value);
    if (price == null) continue;
    const key = `${symbol}|${row.date}`;
    const prev = latest.get(key);
    if (prev && row.as_of < prev.asOf) continue;
    latest.set(key, { date: row.date, price, asOf: row.as_of });
  }
  const out: Record<string, SharePricePoint[]> = {};
  for (const [key, point] of latest) {
    const symbol = key.slice(0, key.indexOf("|"));
    const list = out[symbol] ?? [];
    list.push({ date: point.date, price: point.price });
    out[symbol] = list;
  }
  return out;
}

export function loadInternalPerformance(
  db: Database.Database,
  flavor: FlavorId,
  bucket: InternalPerformanceBucket,
  now = new Date(),
): InternalPerformanceChart {
  const accountWhere = strategyTradesAccountWhereSql(flavor, "a");
  const rows = db
    .prepare(
      `
      SELECT b.account_id, b.trade_date, b.transaction_type, b.raw_json,
             b.symbol, b.underlying_symbol, b.asset_type, b.instruction, b.position_effect,
             b.quantity, b.price, b.option_expiration, b.option_right, b.option_strike,
             a.name AS account_name, a.nickname AS account_nickname, a.account_bucket
      FROM broker_transactions b
      JOIN accounts a ON a.id = b.account_id
      WHERE ${accountWhere}
      ORDER BY b.trade_date ASC, b.id ASC
    `,
    )
    .all() as AccountRow[];

  const scoped = rows.filter((row) => accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket));
  const cusips = tickerByCusip(db);
  const fills = remapFills(
    seedUnexplainedShareFills(
      scoped.flatMap((row) => internalFillsFromStoredRow(row)),
      earliestShareSnapshots(db, flavor, bucket),
    ),
    cusips,
  );
  const openHoldings = latestOpenHoldings(db, flavor, bucket, cusips);
  const history = portfolioRows(db, flavor, bucket, now);
  const dates = history.map((row) => row.date);
  const asOf = nyYmd(now);
  const symbols = [
    ...new Set([...fills.map((fill) => fill.underlying), ...openHoldings.map((holding) => holding.symbol)]),
  ];
  const sharePrices: Record<string, SharePricePoint[]> = {};
  if (symbols.length > 0) {
    const priceRows = db
      .prepare(
        `
        SELECT symbol, date, close, provider
        FROM price_points
        WHERE symbol IN (SELECT value FROM json_each(?))
      `,
      )
      .all(JSON.stringify(symbols)) as Array<{ symbol: string; date: string; close: number; provider: string }>;
    const closes = shareClosesBySymbol(
      priceRows.map((row) => ({ symbol: row.symbol, date: row.date, price: row.close, provider: row.provider })),
    );
    const snapshots = snapshotShareMarks(db, flavor, bucket, cusips);
    for (const symbol of symbols) {
      sharePrices[symbol] = mergeShareMarks(closes[symbol] ?? [], snapshots[symbol] ?? []);
    }
  }

  const optionMarks = (
    db
      .prepare(
        `
        SELECT substr(hs.as_of, 1, 10) AS date,
               UPPER(COALESCE(NULLIF(TRIM(us.symbol), ''), '')) AS underlying,
               sec.expiration_date AS expiration,
               sec.strike_price AS strike,
               sec.option_type AS option_type,
               sec.symbol AS option_symbol,
               p.price AS price,
               a.name AS account_name,
               a.nickname AS account_nickname,
               a.account_bucket AS account_bucket
        FROM positions p
        JOIN holding_snapshots hs ON hs.id = p.snapshot_id
        JOIN accounts a ON a.id = hs.account_id
        JOIN securities sec ON sec.id = p.security_id
        LEFT JOIN securities us ON us.id = sec.underlying_security_id
        WHERE sec.security_type = 'option'
          AND p.price IS NOT NULL
          AND ${accountWhere}
      `,
      )
      .all() as Array<{
      date: string;
      underlying: string;
      expiration: string | null;
      strike: number | null;
      option_type: string | null;
      option_symbol: string | null;
      price: number;
      account_name: string;
      account_nickname: string | null;
      account_bucket: string | null;
    }>
  ).flatMap((row) => {
    if (!accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket)) return [];
    const parsed = parseOptionFromSchwabSymbol(row.option_symbol);
    const type = (row.option_type ?? "").toUpperCase();
    const right = parsed?.right ?? (type.startsWith("P") ? "P" : type.startsWith("C") ? "C" : null);
    const strike = parsed?.strike ?? row.strike;
    const expiration = parsed?.expiration ?? row.expiration?.slice(0, 10) ?? null;
    const underlying = canonicalSymbol(row.underlying || parsed?.underlying || "", cusips) ?? "";
    if (!right || strike == null || !expiration || !underlying || !(row.price > 0)) return [];
    return [{ underlying, right, strike, expiration, date: row.date, price: row.price }];
  });

  const built =
    dates.length > 0
      ? buildInternalPerformanceSeries(fills, { asOf, dates, sharePrices, optionMarks, openHoldings })
      : { symbols: [], bySymbol: {}, audit: [] };

  const ranked = [...built.symbols].sort(
    (a, b) => b.marketValue - a.marketValue || a.symbol.localeCompare(b.symbol),
  );
  const colored = ranked.map((row, index) => ({
    symbol: row.symbol,
    reason: row.reason,
    marketValue: row.marketValue,
    color: POSITION_COLORS[index % POSITION_COLORS.length]!,
    defaultOn: index < INTERNAL_DEFAULT_ON_LIMIT,
  }));
  const portfolioByDate = new Map(history.map((row) => [row.date, row.portfolio]));
  const pointBySymbolDate = new Map<string, { returnPct: number | null; stockPct: number | null }>();
  for (const [symbol, points] of Object.entries(built.bySymbol)) {
    for (const point of points) pointBySymbolDate.set(`${symbol}|${point.date}`, point);
  }

  return {
    symbols: colored,
    audit: built.audit,
    chart_data: dates.map((date, index) => {
      const positions: Record<string, number | null> = {};
      const stocks: Record<string, number | null> = {};
      for (const row of colored) {
        const point = pointBySymbolDate.get(`${row.symbol}|${date}`);
        positions[row.symbol] = point?.returnPct ?? null;
        stocks[row.symbol] = point?.stockPct ?? null;
      }
      return {
        date,
        seq_index: index,
        portfolio: portfolioByDate.get(date) ?? null,
        positions,
        stocks,
      };
    }),
  };
}
