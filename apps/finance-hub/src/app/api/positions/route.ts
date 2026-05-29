import { NextResponse } from "next/server";

import { getDb } from "@/lib/db";
import { logError } from "@/lib/log";
import { isManualAccountId, parseManualPositionMetadata } from "@/lib/manual/manualAccounts";
import { isAuroraExclusiveAccountId } from "@/lib/auroraExclusive";
import { isPosterityAccountId } from "@/lib/posterity";
import { normalizeOptionUnderlying } from "@/lib/options/optionUnderlying";
import {
  allSyncedAccountsWhereSql,
  latestSnapshotIds as latestSyncedSnapshotIds,
} from "@/lib/holdings/latestSnapshots";
import { resolvePositionAveragePrice } from "@/lib/holdings/positionAveragePrice";
import { buildLiveEquityMarkMap, resolveEquityMarkPx } from "@/lib/market/liveEquityMarks";
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

  const underPx = new Map<string, number>();
  for (const u of underRows) {
    const key = (u.symbol ?? "").trim().toUpperCase();
    if (!key) continue;
    const snapshotImplied = u.qty ? u.mv / u.qty : null;
    const markPx = resolveEquityMarkPx(key, liveMarks, pricePoints, snapshotImplied);
    if (markPx != null) underPx.set(key, markPx);
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
        r.quantity && r.marketValue != null ? r.marketValue / r.quantity : r.price ?? null;
      const price = resolveEquityMarkPx(sym, liveMarks, pricePoints, snapshotImplied) ?? r.price;
      let marketValue =
        price != null && Number.isFinite(price) ? price * (r.quantity ?? 0) : r.marketValue;
      if (isManual && r.marketValue != null && !liveMarks.has(sym) && !pricePoints.has(sym)) {
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

function isExcludedAccountId(accountId: string): boolean {
  return isPosterityAccountId(accountId) || isAuroraExclusiveAccountId(accountId);
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
      if (isExcludedAccountId(accountIdParam)) {
        return NextResponse.json(
          { ok: false, error: "This account is not served by the parent positions route." },
          { status: 400 },
        );
      }
      const snap = db
        .prepare(
          `
          SELECT hs.id
          FROM holding_snapshots hs
          JOIN accounts a ON a.id = hs.account_id
          WHERE hs.account_id = ?
            AND ${allSyncedAccountsWhereSql("a")}
          ORDER BY hs.as_of DESC
          LIMIT 1
        `,
        )
        .get(accountIdParam) as { id: string } | undefined;
      snaps = snap ? [snap.id] : [];
      responseSnapshotLabel = snap?.id ?? null;
    } else if (snapshotId != null) {
      const snap = db
        .prepare(
          `
          SELECT hs.id
          FROM holding_snapshots hs
          JOIN accounts a ON a.id = hs.account_id
          WHERE hs.id = ?
            AND ${allSyncedAccountsWhereSql("a")}
          LIMIT 1
        `,
        )
        .get(snapshotId) as { id: string } | undefined;
      snaps = snap ? [snap.id] : [];
      responseSnapshotLabel = snap?.id ?? null;
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
        WHERE ${allSyncedAccountsWhereSql("accounts")}
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
