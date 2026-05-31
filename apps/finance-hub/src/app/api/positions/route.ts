import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { isManualAccountId, parseManualPositionMetadata } from "@/lib/manual/manualAccounts";
import { isPosterityAccountId, notPosterityWhereSql } from "@/lib/posterity";
import { normalizeOptionUnderlying } from "@/lib/options/optionUnderlying";
import { latestSnapshotIds as latestSyncedSnapshotIds } from "@/lib/holdings/latestSnapshots";
import { resolvePositionAveragePrice } from "@/lib/holdings/positionAveragePrice";
import { buildLiveEquityMarkMap, resolveEquityMarkPx } from "@/lib/market/liveEquityMarks";
import { normalizeEquitySymbol } from "@/lib/market/equityMarkPrice";
import {
  isSyntheticFallbackFundBasis,
  markToMarketFund,
  needsPlanFundPricing,
  parseFundStatementBasis,
} from "@/lib/market/planFundPricing";
import {
  fetchYahooLatestPrices,
  loadYahooPricePointsMap,
  persistYahooPricePoints,
} from "@/lib/market/yahooLatestPrice";
import { latestSnapshotId } from "@/lib/snapshots";
import { collectNonIndividualSecuritySymbols } from "@/lib/terminal/individualSecurityFilter";

type ParsedOption = {
  expiration: string; // YYYY-MM-DD
  right: "C" | "P";
  strike: number;
};

function parseOptionFromSecurity(symbol: string | null, name: string | null): ParsedOption | null {
  // Prefer Schwab-style symbol: "TSLA   260619C00260000"
  if (symbol) {
    const s = symbol.replace(/\s+/g, " ").trim();
    const m = s.match(/([0-9]{6})([CP])([0-9]{8})$/);
    if (m) {
      const yy = Number(m[1]!.slice(0, 2));
      const mm = Number(m[1]!.slice(2, 4));
      const dd = Number(m[1]!.slice(4, 6));
      const year = 2000 + yy;
      const strike = Number(m[3]!) / 1000;
      return {
        expiration: `${year.toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`,
        right: m[2]! as "C" | "P",
        strike,
      };
    }
  }

  // Fallback to name: "TSLA 2026-06-19 C 260"
  if (name) {
    const n = name.trim();
    const m2 = n.match(/([0-9]{4}-[0-9]{2}-[0-9]{2})\s+([CP])\s+([0-9]+(\.[0-9]+)?)/);
    if (m2) {
      return { expiration: m2[1]!, right: m2[2]! as "C" | "P", strike: Number(m2[3]!) };
    }
  }

  return null;
}

function daysToExpiration(expirationIso: string, asOfIso: string): number | null {
  const exp = new Date(`${expirationIso}T00:00:00Z`).getTime();
  const asOf = new Date(asOfIso).getTime();
  if (!Number.isFinite(exp) || !Number.isFinite(asOf)) return null;
  return Math.max(0, Math.ceil((exp - asOf) / (24 * 3600 * 1000)));
}

async function buildPositionsForSnapshots(db: ReturnType<typeof getDb>, snaps: string[]) {
  const today = new Date().toISOString().slice(0, 10);
  const pxRows = db
    .prepare(
      `
      SELECT symbol, close
      FROM price_points
      WHERE provider = 'schwab' AND date = ?
    `,
    )
    .all(today) as Array<{ symbol: string; close: number }>;
  const pricePoints = new Map<string, number>();
  for (const r of pxRows) {
    if (r.symbol && Number.isFinite(r.close) && r.close > 0) pricePoints.set(r.symbol.toUpperCase(), r.close);
  }

  const rows = db
    .prepare(
      `
      SELECT
        p.id AS positionId,
        hs.as_of AS asOf,
        a.id AS accountId,
        a.name AS accountName,
        a.type AS accountType,
        a.account_bucket AS accountBucket,
        s.symbol AS symbol,
        s.name AS securityName,
        s.security_type AS securityType,
        us.symbol AS underlyingSymbol,
        p.quantity AS quantity,
        p.price AS price,
        p.market_value AS marketValue,
        p.metadata_json AS metadataJson,
        og.delta AS delta,
        og.gamma AS gamma,
        og.theta AS theta
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN securities us ON us.id = s.underlying_security_id
      LEFT JOIN option_greeks og ON og.position_id = p.id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snapshots_json))
        AND (s.security_type != 'cash' OR a.id LIKE 'manual_%')
      ORDER BY a.name ASC, s.security_type DESC, s.symbol ASC
    `,
    )
    .all({ snapshots_json: JSON.stringify(snaps) }) as Array<{
    positionId: string;
    asOf: string;
    accountId: string;
    accountName: string;
    accountType: string;
    accountBucket: string | null;
    symbol: string | null;
    securityName: string | null;
    securityType: string;
    underlyingSymbol: string | null;
    quantity: number;
    price: number | null;
    marketValue: number | null;
    metadataJson: string | null;
    delta: number | null;
    gamma: number | null;
    theta: number | null;
  }>;

  const underRows = db
    .prepare(
      `
      SELECT s.symbol AS symbol, SUM(p.quantity) AS qty, SUM(COALESCE(p.market_value, 0)) AS mv
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snapshots_json))
        AND s.security_type != 'option'
        AND s.security_type != 'cash'
        AND s.symbol IS NOT NULL
      GROUP BY s.symbol
    `,
    )
    .all({ snapshots_json: JSON.stringify(snaps) }) as Array<{ symbol: string; qty: number; mv: number }>;

  const equitySymbols = new Set<string>();
  for (const u of underRows) {
    const key = (u.symbol ?? "").trim().toUpperCase();
    if (key) equitySymbols.add(key);
  }
  for (const r of rows) {
    if (r.securityType !== "option") continue;
    const eff = normalizeOptionUnderlying(r.underlyingSymbol, r.symbol);
    if (eff && eff !== "CASH") equitySymbols.add(eff);
    const joined = (r.underlyingSymbol ?? "").trim().toUpperCase();
    if (joined && joined !== "CASH") equitySymbols.add(joined);
  }

  const liveMarks = await buildLiveEquityMarkMap(equitySymbols);
  const yahooPricePoints = loadYahooPricePointsMap(db, equitySymbols);

  const yahooFetchSymbols = new Set<string>();
  for (const r of rows) {
    if (r.securityType === "option" || r.securityType === "cash") continue;
    const sym = normalizeEquitySymbol(r.symbol ?? "");
    if (!sym) continue;
    const isManual = isManualAccountId(r.accountId) || parseManualPositionMetadata(r.metadataJson) != null;
    const planFund = needsPlanFundPricing(isManual, r.securityType, r.accountBucket);
    const needsYahoo = planFund || r.securityType === "fund" || isManual;
    if (!needsYahoo) continue;
    // Manual rows: stored MV/qty is stale entry data — never treat as a live mark.
    const snapshotImplied =
      isManual || !(r.quantity && r.marketValue != null)
        ? null
        : r.marketValue / r.quantity;
    const cachedMark = resolveEquityMarkPx(
      sym,
      liveMarks,
      pricePoints,
      snapshotImplied,
      new Map(),
      yahooPricePoints,
    );
    if (cachedMark != null && !isManual) continue;
    yahooFetchSymbols.add(sym);
  }

  const yahooLive =
    yahooFetchSymbols.size > 0 ? await fetchYahooLatestPrices(yahooFetchSymbols) : new Map<string, number>();
  if (yahooLive.size > 0) persistYahooPricePoints(db, yahooLive);

  const underPx = new Map<string, number>();
  for (const u of underRows) {
    const key = (u.symbol ?? "").trim().toUpperCase();
    if (!key) continue;
    const snapshotImplied = u.qty ? u.mv / u.qty : null;
    const markPx = resolveEquityMarkPx(
      key,
      liveMarks,
      pricePoints,
      snapshotImplied,
      yahooLive,
      yahooPricePoints,
    );
    if (markPx != null) underPx.set(key, markPx);
  }
  // Intrinsic/extrinsic for options need underlying spot even when only options are held.
  for (const sym of equitySymbols) {
    if (underPx.has(sym)) continue;
    const markPx = resolveEquityMarkPx(sym, liveMarks, pricePoints, null, yahooLive, yahooPricePoints);
    if (markPx != null) underPx.set(sym, markPx);
  }

  const out = rows.map((r) => {
    const manualMeta = parseManualPositionMetadata(r.metadataJson);
    const isManual = isManualAccountId(r.accountId) || manualMeta != null;

    if (r.securityType === "cash") {
      return {
        ...r,
        symbol: "CASH",
        securityName: "Cash",
        effectiveUnderlyingSymbol: "CASH",
        price: 1,
        marketValue: r.marketValue ?? r.quantity,
        optionExpiration: null,
        optionRight: null,
        optionStrike: null,
        dte: null,
        intrinsic: null,
        extrinsic: null,
        isManual,
        purchaseDate: manualMeta?.purchaseDate ?? null,
      };
    }

    if (r.securityType !== "option") {
      const sym = (r.symbol ?? "").toUpperCase();
      const snapshotImplied =
        isManual || !(r.quantity && r.marketValue != null)
          ? null
          : r.marketValue / r.quantity;
      const markPx = resolveEquityMarkPx(
        sym,
        liveMarks,
        pricePoints,
        snapshotImplied,
        yahooLive,
        yahooPricePoints,
      );
      const qty = r.quantity ?? 0;
      const planFund = needsPlanFundPricing(isManual, r.securityType, r.accountBucket);
      const fundBasis = parseFundStatementBasis(manualMeta);
      const rawFundBasis = manualMeta?.fundBasis ?? null;
      const syntheticFallbackBasis = isSyntheticFallbackFundBasis(rawFundBasis) ? rawFundBasis : null;
      const navToday = markPx ?? yahooLive.get(sym) ?? null;
      // Manual: `price` is purchase cost (Cost/share column).
      const price = isManual ? r.price : (markPx ?? r.price);
      let marketValue: number | null;
      if (planFund && syntheticFallbackBasis) {
        marketValue = syntheticFallbackBasis.statementMarketValue;
        const meta = manualMeta ?? { source: "manual" as const, purchaseDate: null, notes: null };
        db.prepare(`UPDATE positions SET metadata_json = ?, market_value = ? WHERE id = ?`).run(
          JSON.stringify({ source: "manual", purchaseDate: meta.purchaseDate ?? null, notes: meta.notes ?? null }),
          marketValue,
          r.positionId,
        );
      } else if (planFund && fundBasis && navToday != null) {
        marketValue = markToMarketFund(fundBasis, navToday);
        db.prepare(`UPDATE positions SET market_value = ? WHERE id = ?`).run(marketValue, r.positionId);
      } else if (planFund && r.marketValue != null) {
        marketValue = r.marketValue;
      } else if (markPx != null && Number.isFinite(markPx)) {
        marketValue = markPx * qty;
      } else if (isManual) {
        marketValue = r.marketValue;
      } else if (price != null && Number.isFinite(price)) {
        marketValue = price * qty;
      } else {
        marketValue = r.marketValue;
      }
      return {
        ...r,
        symbol: r.symbol ?? "",
        securityName: r.securityName ?? "",
        effectiveUnderlyingSymbol: sym,
        price,
        marketValue,
        optionExpiration: null,
        optionRight: null,
        optionStrike: null,
        dte: null,
        intrinsic: null,
        extrinsic: null,
        isManual,
        purchaseDate: manualMeta?.purchaseDate ?? null,
      };
    }

    const sym = (r.symbol ?? "").toUpperCase();
    const qpx = sym ? pricePoints.get(sym) ?? null : null;
    const averagePrice = resolvePositionAveragePrice(r.price, r.metadataJson);
    const qty = r.quantity ?? 0;
    const syncedMark =
      r.marketValue != null && Number.isFinite(r.marketValue) && qty !== 0
        ? r.marketValue / (qty * 100)
        : null;
    const markPrice = qpx ?? syncedMark ?? averagePrice;
    const price = markPrice;
    const marketValue =
      markPrice != null && Number.isFinite(markPrice) && qty !== 0 ? markPrice * 100 * qty : r.marketValue;

    const parsed = parseOptionFromSecurity(r.symbol, r.securityName);
    const dte = parsed ? daysToExpiration(parsed.expiration, r.asOf) : null;
    const effectiveUnderlyingSymbol = normalizeOptionUnderlying(r.underlyingSymbol, r.symbol);
    const fromJoined = r.underlyingSymbol
      ? underPx.get((r.underlyingSymbol ?? "").trim().toUpperCase())
      : undefined;
    const S = fromJoined ?? underPx.get(effectiveUnderlyingSymbol);
    const K = parsed?.strike;
    const right = parsed?.right;
    const qtyAbs = Math.abs(qty);
    const premium = (price ?? 0) * 100 * qtyAbs;

    let intrinsic = null as number | null;
    if (S != null && K != null && right) {
      const perShare =
        right === "C" ? Math.max(0, S - K) : Math.max(0, K - S);
      intrinsic = perShare * 100 * qtyAbs;
    }
    const extrinsic = intrinsic == null ? null : premium - intrinsic;

    return {
      ...r,
      symbol: r.symbol ?? "",
      securityName: r.securityName ?? "",
      effectiveUnderlyingSymbol,
      averagePrice,
      price,
      marketValue,
      optionExpiration: parsed?.expiration ?? null,
      optionRight: parsed?.right ?? null,
      optionStrike: parsed?.strike ?? null,
      dte,
      intrinsic,
      extrinsic,
      isManual,
      purchaseDate: manualMeta?.purchaseDate ?? null,
    };
  });

  return out;
}

function nonIndividualSecuritySymbolsForSnapshots(db: ReturnType<typeof getDb>, snaps: string[]): string[] {
  if (snaps.length === 0) return [];
  const rows = db
    .prepare(
      `
      SELECT
        s.symbol AS symbol,
        s.security_type AS securityType,
        p.metadata_json AS metadataJson,
        us.symbol AS underlyingSymbol,
        us.security_type AS underlyingSecurityType
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN securities us ON us.id = s.underlying_security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snapshots_json))
        AND s.security_type != 'cash'
    `,
    )
    .all({ snapshots_json: JSON.stringify(snaps) }) as Array<{
    symbol: string | null;
    securityType: string;
    metadataJson: string | null;
    underlyingSymbol: string | null;
    underlyingSecurityType: string | null;
  }>;
  return collectNonIndividualSecuritySymbols(rows);
}

export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const accountIdParam = url.searchParams.get("accountId");
    const snapshotId = url.searchParams.get("snapshotId");

    const db = getDb();
    const latest = latestSnapshotId(db);

    let snaps: string[] = [];
    let responseSnapshotLabel: string | null = null;

    if (accountIdParam) {
      if (isPosterityAccountId(accountIdParam)) {
        return NextResponse.json(
          { ok: false, error: "Posterity accounts are not served by this route; use posterity APIs." },
          { status: 400 },
        );
      }
      const snap = db
        .prepare(
          `SELECT id FROM holding_snapshots WHERE account_id = ? ORDER BY as_of DESC LIMIT 1`,
        )
        .get(accountIdParam) as { id: string } | undefined;
      snaps = snap ? [snap.id] : [];
      responseSnapshotLabel = snap?.id ?? null;
    } else if (snapshotId != null) {
      snaps = [snapshotId];
      responseSnapshotLabel = snapshotId;
    } else {
      snaps = latestSyncedSnapshotIds(db, "all_synced");
      responseSnapshotLabel = latest ?? null;
    }

    if (snaps.length === 0 && !latest && !accountIdParam) {
      return NextResponse.json({ ok: true, snapshotId: null, positions: [], accounts: [], nonIndividualSecuritySymbols: [] });
    }

    if (snaps.length === 0) {
      return NextResponse.json({
        ok: true,
        snapshotId: responseSnapshotLabel,
        snapshots: [],
        positions: [],
        accounts: [],
        nonIndividualSecuritySymbols: [],
      });
    }

    const out = await buildPositionsForSnapshots(db, snaps);
    const nonIndividualSecuritySymbols = nonIndividualSecuritySymbolsForSnapshots(db, snaps);

    const accounts = db
      .prepare(
        `
        SELECT id, name, nickname, type, connection_id, account_bucket AS accountBucket
        FROM accounts
        ORDER BY name ASC
      `,
      )
      .all() as Array<{
      id: string;
      name: string;
      nickname: string | null;
      type: string;
      connection_id: string;
      accountBucket: string | null;
    }>;

    return NextResponse.json({
      ok: true,
      snapshotId: snapshotId ?? responseSnapshotLabel ?? latest ?? null,
      snapshots: snaps,
      positions: out,
      accounts,
      nonIndividualSecuritySymbols,
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    logError("api_positions_get", e);
    return NextResponse.json(
      { ok: false, error: msg, snapshotId: null, snapshots: [], positions: [], nonIndividualSecuritySymbols: [] },
      { status: 500 },
    );
  }
}
