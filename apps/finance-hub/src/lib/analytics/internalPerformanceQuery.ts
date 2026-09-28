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
  freshAccountIds,
  internalFillsFromStoredRow,
  mergeShareMarks,
  latestShareSnapshotsByDay,
  seedUnexplainedShareFills,
  shareClosesBySymbol,
  snapshotMarkPerShare,
  type ShareSnapshotRow,
  type InternalAudit,
  type InternalFill,
  type InternalReturnMethod,
  type OpenHolding,
  type OptionDeltaPoint,
  type QualifyReason,
  type ShareHoldingSnapshot,
  type SharePricePoint,
  type StoredBrokerFillRow,
} from "@/lib/analytics/internalPerformance";
import { bucketFromAccount, type AccountBucket } from "@/lib/accountBuckets";
import type { FlavorId } from "@/lib/flavor";
import { resolvePositionAveragePrice } from "@/lib/holdings/positionAveragePrice";
import { nyYmd } from "@/lib/market/usEquitySession";
import { optionMarkFromMarketValue, resolveOptionContractMultiplier } from "@/lib/options/optionContractMultiplier";
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
  method: InternalReturnMethod;
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

function snapshotCostPerShare(
  price: number | null,
  quantity: number,
  marketValue: number | null,
  metadataJson: string | null,
): number | null {
  const average = resolvePositionAveragePrice(price, metadataJson);
  if (average != null && average > 0) return average;
  return snapshotMarkPerShare({ quantity, marketValue, metadataJson });
}

function optionPremiumPerShare(quantity: number, marketValue: number | null, metadataJson: string | null): number | null {
  const multiplier = resolveOptionContractMultiplier(metadataJson);
  const fromValues = (value: number, qty: number): number | null => {
    const mark = optionMarkFromMarketValue(value, qty, multiplier);
    if (mark == null || !(Math.abs(mark) > 0)) return null;
    return Math.abs(mark);
  };
  if (marketValue != null) {
    const fromColumn = fromValues(marketValue, quantity);
    if (fromColumn != null) return fromColumn;
  }
  if (!metadataJson) return null;
  try {
    const meta = JSON.parse(metadataJson) as { marketValue?: unknown; longQuantity?: unknown; shortQuantity?: unknown };
    if (typeof meta.marketValue !== "number" || !Number.isFinite(meta.marketValue)) return null;
    const longQty = typeof meta.longQuantity === "number" && Number.isFinite(meta.longQuantity) ? meta.longQuantity : 0;
    const shortQty = typeof meta.shortQuantity === "number" && Number.isFinite(meta.shortQuantity) ? meta.shortQuantity : 0;
    const qty = longQty - shortQty !== 0 ? longQty - shortQty : quantity;
    return fromValues(meta.marketValue, qty);
  } catch {
    return null;
  }
}

function holdingMarketValue(
  quantity: number,
  marketValue: number | null,
  metadataJson: string | null,
  isOption: boolean,
): number {
  if (marketValue != null && Number.isFinite(marketValue)) return Math.abs(marketValue);
  if (isOption) {
    const premium = optionPremiumPerShare(quantity, null, metadataJson);
    if (premium == null) return 0;
    return Math.abs(premium * quantity * resolveOptionContractMultiplier(metadataJson));
  }
  const mark = snapshotMarkPerShare({ quantity, marketValue: null, metadataJson });
  return mark == null ? 0 : Math.abs(mark * quantity);
}

function freshAccounts(db: Database.Database, flavor: FlavorId, bucket: InternalPerformanceBucket): Set<string> {
  const accountWhere = strategyTradesAccountWhereSql(flavor, "a");
  const rows = db
    .prepare(
      `
      SELECT hs.account_id AS account_id,
             MAX(substr(hs.as_of, 1, 10)) AS last_snapshot,
             a.name AS account_name,
             a.nickname AS account_nickname,
             a.account_bucket AS account_bucket
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      WHERE ${accountWhere}
      GROUP BY hs.account_id
    `,
    )
    .all() as Array<{
    account_id: string;
    last_snapshot: string;
    account_name: string;
    account_nickname: string | null;
    account_bucket: string | null;
  }>;
  return freshAccountIds(
    rows
      .filter((row) => accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket))
      .map((row) => ({ accountId: row.account_id, lastSnapshot: row.last_snapshot })),
  );
}

function shareSnapshotRows(
  db: Database.Database,
  flavor: FlavorId,
  bucket: InternalPerformanceBucket,
  fresh: Set<string>,
): ShareSnapshotRow[] {
  const accountWhere = strategyTradesAccountWhereSql(flavor, "a");
  const rows = db
    .prepare(
      `
      SELECT hs.account_id AS account_id,
             hs.as_of AS as_of,
             substr(hs.as_of, 1, 10) AS date,
             UPPER(TRIM(sec.symbol)) AS symbol,
             p.quantity AS quantity,
             p.price AS price,
             p.market_value AS market_value,
             p.metadata_json AS metadata_json,
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
    as_of: string;
    date: string;
    symbol: string;
    quantity: number;
    price: number | null;
    market_value: number | null;
    metadata_json: string | null;
    account_name: string;
    account_nickname: string | null;
    account_bucket: string | null;
  }>;

  return latestShareSnapshotsByDay(
    rows.flatMap((row) => {
      if (!fresh.has(row.account_id)) return [];
      if (!accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket)) return [];
      if (!row.symbol) return [];
      return [
        {
          accountId: row.account_id,
          symbol: row.symbol,
          date: row.date,
          asOf: row.as_of,
          quantity: row.quantity,
          price: snapshotCostPerShare(row.price, row.quantity, row.market_value, row.metadata_json),
        },
      ];
    }),
  );
}

function earliestShareSnapshots(rows: ShareSnapshotRow[]): ShareHoldingSnapshot[] {
  const earliest = new Map<string, ShareHoldingSnapshot>();
  for (const row of rows) {
    const key = `${row.accountId}|${row.symbol}`;
    const prev = earliest.get(key);
    if (prev && row.date >= prev.date) continue;
    earliest.set(key, row);
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

function latestOpenHoldings(
  db: Database.Database,
  flavor: FlavorId,
  bucket: InternalPerformanceBucket,
  cusips: Map<string, string>,
  fresh: Set<string>,
): OpenHolding[] {
  const accountWhere = strategyTradesAccountWhereSql(flavor, "a");
  const rows = db
    .prepare(
      `
      SELECT hs.account_id AS account_id,
             UPPER(TRIM(sec.symbol)) AS symbol,
             sec.security_type AS security_type,
             sec.expiration_date AS expiration,
             sec.strike_price AS strike,
             sec.option_type AS option_type,
             UPPER(COALESCE(NULLIF(TRIM(us.symbol), ''), '')) AS underlying,
             p.quantity AS quantity,
             p.market_value AS market_value,
             p.metadata_json AS metadata_json,
             a.name AS account_name,
             a.nickname AS account_nickname,
             a.account_bucket AS account_bucket
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities sec ON sec.id = p.security_id
      LEFT JOIN securities us ON us.id = sec.underlying_security_id
      JOIN (
        SELECT hs2.account_id AS account_id, MAX(hs2.id) AS snapshot_id
        FROM holding_snapshots hs2
        JOIN (
          SELECT account_id, MAX(as_of) AS max_as_of
          FROM holding_snapshots
          GROUP BY account_id
        ) newest ON newest.account_id = hs2.account_id AND newest.max_as_of = hs2.as_of
        GROUP BY hs2.account_id
      ) latest ON latest.snapshot_id = hs.id
      WHERE sec.security_type != 'cash'
        AND ${accountWhere}
    `,
    )
    .all() as Array<{
    account_id: string;
    symbol: string;
    security_type: string;
    expiration: string | null;
    strike: number | null;
    option_type: string | null;
    underlying: string;
    quantity: number;
    market_value: number | null;
    metadata_json: string | null;
    account_name: string;
    account_nickname: string | null;
    account_bucket: string | null;
  }>;

  const out: OpenHolding[] = [];
  for (const row of rows) {
    if (!fresh.has(row.account_id)) continue;
    if (!accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket)) continue;
    if (!Number.isFinite(row.quantity) || Math.abs(row.quantity) < 1e-9) continue;
    const parsed = parseOptionFromSchwabSymbol(row.symbol);
    const isOption = row.security_type === "option" || parsed != null;
    const marketValue = holdingMarketValue(row.quantity, row.market_value, row.metadata_json, isOption);
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
  fresh: Set<string>,
): Record<string, SharePricePoint[]> {
  const accountWhere = strategyTradesAccountWhereSql(flavor, "a");
  const rows = db
    .prepare(
      `
      SELECT hs.account_id AS account_id,
             substr(hs.as_of, 1, 10) AS date,
             hs.as_of AS as_of,
             UPPER(TRIM(sec.symbol)) AS symbol,
             p.quantity AS quantity,
             p.market_value AS market_value,
             p.metadata_json AS metadata_json,
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
    account_id: string;
    date: string;
    as_of: string;
    symbol: string;
    quantity: number;
    market_value: number | null;
    metadata_json: string | null;
    account_name: string;
    account_nickname: string | null;
    account_bucket: string | null;
  }>;

  const latest = new Map<string, SharePricePoint & { asOf: string }>();
  for (const row of rows) {
    if (!fresh.has(row.account_id)) continue;
    if (!accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket)) continue;
    const symbol = canonicalSymbol(row.symbol, cusips);
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(row.date)) continue;
    const price = snapshotMarkPerShare({
      quantity: row.quantity,
      marketValue: row.market_value,
      metadataJson: row.metadata_json,
    });
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

function optionDeltaPoints(
  db: Database.Database,
  flavor: FlavorId,
  bucket: InternalPerformanceBucket,
  cusips: Map<string, string>,
  fresh: Set<string>,
): OptionDeltaPoint[] {
  const accountWhere = strategyTradesAccountWhereSql(flavor, "a");
  const rows = db
    .prepare(
      `
      SELECT hs.account_id AS account_id,
             hs.as_of AS as_of,
             substr(hs.as_of, 1, 10) AS date,
             UPPER(COALESCE(NULLIF(TRIM(us.symbol), ''), '')) AS underlying,
             sec.expiration_date AS expiration,
             sec.strike_price AS strike,
             sec.option_type AS option_type,
             sec.symbol AS option_symbol,
             og.delta AS delta,
             a.name AS account_name,
             a.nickname AS account_nickname,
             a.account_bucket AS account_bucket
      FROM option_greeks og
      JOIN positions p ON p.id = og.position_id
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities sec ON sec.id = p.security_id
      LEFT JOIN securities us ON us.id = sec.underlying_security_id
      WHERE sec.security_type = 'option'
        AND og.delta IS NOT NULL
        AND ${accountWhere}
      ORDER BY hs.as_of ASC
    `,
    )
    .all() as Array<{
    account_id: string;
    as_of: string;
    date: string;
    underlying: string;
    expiration: string | null;
    strike: number | null;
    option_type: string | null;
    option_symbol: string | null;
    delta: number;
    account_name: string;
    account_nickname: string | null;
    account_bucket: string | null;
  }>;
  const latest = new Map<string, OptionDeltaPoint & { asOf: string }>();
  for (const row of rows) {
    if (!fresh.has(row.account_id)) continue;
    if (!accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket)) continue;
    const parsed = parseOptionFromSchwabSymbol(row.option_symbol);
    const type = (row.option_type ?? "").toUpperCase();
    const right = parsed?.right ?? (type.startsWith("P") ? "P" : type.startsWith("C") ? "C" : null);
    const strike = parsed?.strike ?? row.strike;
    const expiration = parsed?.expiration ?? row.expiration?.slice(0, 10) ?? null;
    const underlying = canonicalSymbol(row.underlying || parsed?.underlying || "", cusips) ?? "";
    if (!right || strike == null || !expiration || !underlying || !Number.isFinite(row.delta)) continue;
    const key = `${underlying}|${right}|${strike}|${expiration}|${row.date}`;
    const prev = latest.get(key);
    if (prev && row.as_of < prev.asOf) continue;
    latest.set(key, { underlying, right, strike, expiration, date: row.date, delta: row.delta, asOf: row.as_of });
  }
  return [...latest.values()].map((row) => ({
    underlying: row.underlying,
    right: row.right,
    strike: row.strike,
    expiration: row.expiration,
    date: row.date,
    delta: row.delta,
  }));
}

export function loadInternalPerformance(
  db: Database.Database,
  flavor: FlavorId,
  bucket: InternalPerformanceBucket,
  method: InternalReturnMethod = "capital",
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

  const fresh = freshAccounts(db, flavor, bucket);
  const scoped = rows.filter(
    (row) => fresh.has(row.account_id) && accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket),
  );
  const cusips = tickerByCusip(db);
  const rawShareSnapshots = shareSnapshotRows(db, flavor, bucket, fresh);
  const fills = remapFills(
    seedUnexplainedShareFills(
      scoped.flatMap((row) => internalFillsFromStoredRow(row)),
      earliestShareSnapshots(rawShareSnapshots),
    ),
    cusips,
  );
  const shareSnapshots = rawShareSnapshots.flatMap((row) => {
    const symbol = canonicalSymbol(row.symbol, cusips);
    return symbol ? [{ ...row, symbol }] : [];
  });
  const openHoldings = latestOpenHoldings(db, flavor, bucket, cusips, fresh);
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
    const snapshots = snapshotShareMarks(db, flavor, bucket, cusips, fresh);
    for (const symbol of symbols) {
      sharePrices[symbol] = mergeShareMarks(closes[symbol] ?? [], snapshots[symbol] ?? []);
    }
  }

  const optionMarkRows = db
    .prepare(
      `
      SELECT hs.account_id AS account_id,
             hs.as_of AS as_of,
             substr(hs.as_of, 1, 10) AS date,
             UPPER(COALESCE(NULLIF(TRIM(us.symbol), ''), '')) AS underlying,
             sec.expiration_date AS expiration,
             sec.strike_price AS strike,
             sec.option_type AS option_type,
             sec.symbol AS option_symbol,
             p.quantity AS quantity,
             p.market_value AS market_value,
             p.metadata_json AS metadata_json,
             a.name AS account_name,
             a.nickname AS account_nickname,
             a.account_bucket AS account_bucket
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities sec ON sec.id = p.security_id
      LEFT JOIN securities us ON us.id = sec.underlying_security_id
      WHERE sec.security_type = 'option'
        AND ${accountWhere}
      ORDER BY hs.as_of ASC
    `,
    )
    .all() as Array<{
    account_id: string;
    as_of: string;
    date: string;
    underlying: string;
    expiration: string | null;
    strike: number | null;
    option_type: string | null;
    option_symbol: string | null;
    quantity: number;
    market_value: number | null;
    metadata_json: string | null;
    account_name: string;
    account_nickname: string | null;
    account_bucket: string | null;
  }>;
  const optionLatest = new Map<string, { underlying: string; right: "C" | "P"; strike: number; expiration: string; date: string; price: number; asOf: string }>();
  for (const row of optionMarkRows) {
    if (!fresh.has(row.account_id)) continue;
    if (!accountInBucket(bucket, row.account_name, row.account_nickname, row.account_bucket)) continue;
    const parsed = parseOptionFromSchwabSymbol(row.option_symbol);
    const type = (row.option_type ?? "").toUpperCase();
    const right = parsed?.right ?? (type.startsWith("P") ? "P" : type.startsWith("C") ? "C" : null);
    const strike = parsed?.strike ?? row.strike;
    const expiration = parsed?.expiration ?? row.expiration?.slice(0, 10) ?? null;
    const underlying = canonicalSymbol(row.underlying || parsed?.underlying || "", cusips) ?? "";
    const price = optionPremiumPerShare(row.quantity, row.market_value, row.metadata_json);
    if (!right || strike == null || !expiration || !underlying || price == null) continue;
    const key = `${underlying}|${right}|${strike}|${expiration}|${row.date}`;
    const prev = optionLatest.get(key);
    if (prev && row.as_of < prev.asOf) continue;
    optionLatest.set(key, { underlying, right, strike, expiration, date: row.date, price, asOf: row.as_of });
  }
  const optionMarks = [...optionLatest.values()].map((row) => ({
    underlying: row.underlying,
    right: row.right,
    strike: row.strike,
    expiration: row.expiration,
    date: row.date,
    price: row.price,
  }));

  const optionDeltas = optionDeltaPoints(db, flavor, bucket, cusips, fresh);
  const built =
    dates.length > 0
      ? buildInternalPerformanceSeries(fills, {
          asOf,
          dates,
          sharePrices,
          optionMarks,
          optionDeltas,
          openHoldings,
          shareSnapshots,
          method,
        })
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
    method,
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
