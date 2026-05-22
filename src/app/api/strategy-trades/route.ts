import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { notPosterityWhereSql } from "@/lib/posterity";
import { isStrategyTabSlug } from "@/lib/strategy/strategyCategories";
import {
  computeStrategyStats,
  notionalForPnlPct,
  type StrategyTradeApiRow,
} from "@/lib/strategy/strategyTradeStats";

/** When the TRADE ledger is empty, surface latest option holdings so the page is not blank. */
function openOptionPositionsAsTradeRows(db: ReturnType<typeof getDb>, posteritySql: string): StrategyTradeApiRow[] {
  const snapRows = db
    .prepare(
      `
      SELECT hs.id AS snapshot_id
      FROM holding_snapshots hs
      JOIN accounts a ON a.id = hs.account_id
      WHERE a.id LIKE 'schwab_%'
        AND ${posteritySql}
        AND hs.as_of = (
          SELECT MAX(hs2.as_of) FROM holding_snapshots hs2 WHERE hs2.account_id = a.id
        )
    `,
    )
    .all() as { snapshot_id: string }[];
  if (snapRows.length === 0) return [];

  const snapshotsJson = JSON.stringify(snapRows.map((r) => r.snapshot_id));
  type PosRow = {
    pid: string;
    as_of: string;
    account_name: string;
    account_id: string;
    symbol: string | null;
    underlying_symbol: string | null;
    quantity: number;
    price: number | null;
  };
  const raw = db
    .prepare(
      `
      SELECT
        p.id AS pid,
        hs.as_of AS as_of,
        a.name AS account_name,
        a.id AS account_id,
        s.symbol AS symbol,
        us.symbol AS underlying_symbol,
        p.quantity AS quantity,
        p.price AS price
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN securities us ON us.id = s.underlying_security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snapshots_json))
        AND s.security_type = 'option'
        AND ABS(p.quantity) > 1e-9
      ORDER BY hs.as_of DESC, a.name ASC, s.symbol ASC
    `,
    )
    .all({ snapshots_json: snapshotsJson }) as PosRow[];

  return raw.map((r) => ({
    id: `pos:${r.pid}`,
    accountId: r.account_id,
    accountName: r.account_name,
    symbol: r.symbol,
    underlyingSymbol: r.underlying_symbol,
    securityType: "option" as const,
    entryDate: r.as_of,
    exitDate: null,
    quantity: r.quantity,
    entryPrice: r.price,
    exitOrCurrentPrice: r.price,
    pnlDollars: null,
    pnlPct: null,
    pctGain: null,
    description: "Open position (latest snapshot — not a synced TRADE row)",
    legCount: 1,
    transactionType: null,
    strategyCategory: null,
  }));
}

type DbTx = {
  id: string;
  account_id: string;
  account_name: string;
  trade_date: string;
  transaction_type: string | null;
  description: string | null;
  net_amount: number | null;
  symbol: string | null;
  underlying_symbol: string | null;
  asset_type: string | null;
  quantity: number | null;
  price: number | null;
  leg_count: number;
  strategy_category: string | null;
};

function toApiRow(r: DbTx): StrategyTradeApiRow {
  const asset = (r.asset_type ?? "").toUpperCase();
  const securityType = asset === "OPTION" ? "option" : asset === "EQUITY" ? "equity" : "unknown";
  const pnl = r.net_amount;
  const notional = notionalForPnlPct(r.quantity, r.price, r.asset_type);
  const pnlPct = pnl != null && notional != null && notional > 0 ? (pnl / notional) * 100 : null;

  return {
    id: r.id,
    accountId: r.account_id,
    accountName: r.account_name,
    symbol: r.symbol,
    underlyingSymbol: r.underlying_symbol,
    securityType,
    entryDate: r.trade_date,
    exitDate: null,
    quantity: r.quantity,
    entryPrice: r.price,
    exitOrCurrentPrice: null,
    pnlDollars: pnl,
    pnlPct,
    pctGain: pnlPct,
    description: r.description,
    legCount: r.leg_count,
    transactionType: r.transaction_type,
    strategyCategory: r.strategy_category,
  };
}

function toCsv(rows: StrategyTradeApiRow[], includeStrategyColumn: boolean): string {
  const headers = [
    "symbol",
    "underlying",
    ...(includeStrategyColumn ? (["strategy"] as const) : []),
    "entryDate",
    "exitDate",
    "quantity",
    "entryPrice",
    "exitOrCurrent",
    "pnlDollars",
    "pnlPct",
    "account",
    "description",
  ];
  const lines = [headers.join(",")];
  for (const r of rows) {
    const esc = (s: string | null | undefined) => {
      const v = (s ?? "").replace(/"/g, '""');
      return `"${v}"`;
    };
    lines.push(
      [
        esc(r.symbol),
        esc(r.underlyingSymbol),
        ...(includeStrategyColumn ? [esc(r.strategyCategory)] : []),
        r.entryDate,
        r.exitDate ?? "",
        r.quantity ?? "",
        r.entryPrice ?? "",
        r.exitOrCurrentPrice ?? "",
        r.pnlDollars ?? "",
        r.pnlPct ?? "",
        esc(r.accountName),
        esc(r.description),
      ].join(","),
    );
  }
  return lines.join("\n");
}

export async function GET(req: Request) {
  try {
    const { searchParams } = new URL(req.url);
    const category = searchParams.get("category") ?? "";
    if (!isStrategyTabSlug(category)) {
      return NextResponse.json(
        {
          ok: false,
          error:
            "Invalid category. Use one of: all, covered-calls, earnings, options-sales, leaps, spreads, uncategorized",
        },
        { status: 400 },
      );
    }

    const format = searchParams.get("format") ?? "json";

    const db = getDb();
    const posterity = notPosterityWhereSql("a");

    type CountRow = { c: number };
    const storedTradeRowCount = (db.prepare(`SELECT COUNT(*) AS c FROM broker_transactions`).get() as CountRow).c;

    const categoryFilterSql =
      category === "all" ? "" : "AND b.strategy_category = @category";

    const rows = db
      .prepare(
        `
        SELECT
          b.id AS id,
          b.account_id AS account_id,
          a.name AS account_name,
          b.trade_date AS trade_date,
          b.transaction_type AS transaction_type,
          b.description AS description,
          b.net_amount AS net_amount,
          b.symbol AS symbol,
          b.underlying_symbol AS underlying_symbol,
          b.asset_type AS asset_type,
          b.quantity AS quantity,
          b.price AS price,
          b.leg_count AS leg_count,
          b.strategy_category AS strategy_category
        FROM broker_transactions b
        JOIN accounts a ON a.id = b.account_id
        WHERE 1=1
          ${categoryFilterSql}
          AND ${posterity}
        ORDER BY b.trade_date DESC, b.id DESC
      `,
      )
      .all(category === "all" ? {} : { category }) as DbTx[];

    let trades = rows.map(toApiRow);
    let tradeDataSource: "ledger" | "positions_preview" = "ledger";
    if (trades.length === 0 && category === "all") {
      const preview = openOptionPositionsAsTradeRows(db, posterity);
      if (preview.length > 0) {
        trades = preview;
        tradeDataSource = "positions_preview";
      }
    }

    const stats = computeStrategyStats(trades);

    if (format === "csv") {
      const csv = toCsv(trades, category === "all");
      return new NextResponse(csv, {
        status: 200,
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="strategy-${category}-all.csv"`,
        },
      });
    }

    return NextResponse.json({
      ok: true,
      category,
      storedTradeRowCount,
      tradeDataSource,
      trades,
      stats,
    });
  } catch (e) {
    logError("strategy_trades_get_failed", e);
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 },
    );
  }
}
