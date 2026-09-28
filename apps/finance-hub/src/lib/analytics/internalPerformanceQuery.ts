import type Database from "better-sqlite3";

import {
  filterSeriesFromBaseline,
  getGlanceAlignedPortfolioValueSeriesByBucket,
  mergeMissingSnapshotDays,
  resolvePerformanceTrackingBaselineYmd,
} from "@/lib/analytics/glanceAlignedPerformance";
import {
  buildInternalPerformanceSeries,
  internalFillsFromStoredRow,
  type QualifyReason,
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
  symbols: Array<{ symbol: string; reason: QualifyReason; color: string }>;
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

function portfolioRows(db: Database.Database, flavor: FlavorId, bucket: InternalPerformanceBucket, now: Date) {
  const denseAll = mergeMissingSnapshotDays(
    getGlanceAlignedPortfolioValueSeriesByBucket(bucket, db, flavor),
    (
      db
        .prepare(
          `SELECT snapshot_date, total_value FROM portfolio_snapshots WHERE bucket = ? ORDER BY snapshot_date ASC`,
        )
        .all(bucket) as Array<{ snapshot_date: string; total_value: number }>
    ),
  );
  const tradingAll = collapseToTradingDays(denseAll);
  const { baselineYmd } = resolvePerformanceTrackingBaselineYmd(tradingAll, now);
  const trading = filterSeriesFromBaseline(tradingAll, baselineYmd);
  if (trading.length === 0) return [];
  return extendChartDataThroughNow(chartDataFromDenseSeries(trading, [], []), [], [], now.getTime());
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
  const fills = scoped.flatMap((row) => internalFillsFromStoredRow(row));
  const history = portfolioRows(db, flavor, bucket, now);
  const dates = history.map((row) => row.date);
  const asOf = nyYmd(now);
  const symbols = [...new Set(fills.map((fill) => fill.underlying))];
  const sharePrices: Record<string, Array<{ date: string; price: number }>> = {};
  if (symbols.length > 0) {
    const priceRows = db
      .prepare(
        `
        SELECT symbol, date, close
        FROM price_points
        WHERE symbol IN (SELECT value FROM json_each(?))
        ORDER BY symbol ASC, date ASC, CASE WHEN provider = 'schwab' THEN 1 ELSE 0 END ASC
      `,
      )
      .all(JSON.stringify(symbols)) as Array<{ symbol: string; date: string; close: number }>;
    for (const row of priceRows) {
      const symbol = row.symbol.trim().toUpperCase();
      const list = sharePrices[symbol] ?? [];
      list.push({ date: row.date.slice(0, 10), price: row.close });
      sharePrices[symbol] = list;
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
    const underlying = (row.underlying || parsed?.underlying || "").trim().toUpperCase();
    if (!right || strike == null || !expiration || !underlying || !(row.price > 0)) return [];
    return [{ underlying, right, strike, expiration, date: row.date, price: row.price }];
  });

  const built =
    dates.length > 0
      ? buildInternalPerformanceSeries(fills, { asOf, dates, sharePrices, optionMarks })
      : { symbols: [], bySymbol: {} };

  const colored = built.symbols.map((row, index) => ({
    ...row,
    color: POSITION_COLORS[index % POSITION_COLORS.length]!,
  }));
  const portfolioByDate = new Map(history.map((row) => [row.date, row.portfolio]));
  const pointBySymbolDate = new Map<string, { returnPct: number | null; stockPct: number | null }>();
  for (const [symbol, points] of Object.entries(built.bySymbol)) {
    for (const point of points) pointBySymbolDate.set(`${symbol}|${point.date}`, point);
  }

  return {
    symbols: colored,
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
