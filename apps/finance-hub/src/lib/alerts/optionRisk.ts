import type Database from "better-sqlite3";

import { optionMarginSecuredDollars } from "@/lib/options/optionMarginRoi";
import { optionMarkPerShare } from "@/lib/options/optionPnlFromAvgPrice";
import { normalizeOptionUnderlying } from "@/lib/options/optionUnderlying";
import { resolvePositionAveragePrice } from "@/lib/holdings/positionAveragePrice";
import { latestSnapshotIds, type LatestSnapshotScope } from "@/lib/holdings/latestSnapshots";
import { longShareQuantityForUnderlying } from "@/lib/strategy/equityCoverage";
import type { FlavorId } from "@/lib/flavor";

export const OPTION_RISK_RULE_TYPES = [
  "undefined-risk",
  "naked-short",
  "delta-band",
  "option-dte",
  "margin-pressure",
  "assignment",
] as const;

export type OptionRiskRuleType = (typeof OPTION_RISK_RULE_TYPES)[number];

export type OptionRiskFlags = {
  undefinedRisk: boolean;
  nakedShort: boolean;
  structure: "naked-call" | "naked-put" | "short-strangle" | "covered-call" | "other";
  maxLoss: "unbounded" | "defined" | null;
  absDelta: number | null;
  deltaOffBand: boolean;
  shortDte: boolean;
  assignmentNear: boolean;
  itm: boolean;
};

export type OptionRiskPosition = {
  positionId: string;
  accountId: string;
  accountName: string;
  symbol: string;
  underlying: string;
  quantity: number;
  right: "C" | "P" | null;
  strike: number | null;
  expiration: string | null;
  dte: number | null;
  delta: number | null;
  spot: number | null;
  intrinsic: number | null;
  marginSecured: number | null;
  /** Schwab average entry (per share). */
  avgPrice: number | null;
  /** Current mark per share (absolute). */
  markPrice: number | null;
  /** Implied vol from option_greeks (percent or decimal). */
  iv: number | null;
  flags: OptionRiskFlags;
};

export type OptionRiskSummary = {
  positions: OptionRiskPosition[];
  undefinedRiskCount: number;
  nakedShortCount: number;
  marginPressure: Array<{
    accountId: string;
    accountName: string;
    marginSecured: number;
    equity: number | null;
    marginPct: number | null;
    breached: boolean;
  }>;
};

export type OptionRiskConfigs = {
  targetAbsDelta: number;
  deltaBand: number;
  maxDte: number;
  maxMarginPct: number;
  nearStrikePct: number;
};

export const DEFAULT_OPTION_RISK_CONFIGS: OptionRiskConfigs = {
  targetAbsDelta: 0.15,
  deltaBand: 0.05,
  maxDte: 21,
  maxMarginPct: 0.25,
  nearStrikePct: 0.02,
};

function parseOcc(symbol: string | null): { expiration: string; right: "C" | "P"; strike: number } | null {
  if (!symbol) return null;
  const s = symbol.replace(/\s+/g, " ").trim();
  const m = s.match(/([0-9]{6})([CP])([0-9]{8})$/);
  if (!m) return null;
  const yy = Number(m[1]!.slice(0, 2));
  const mm = Number(m[1]!.slice(2, 4));
  const dd = Number(m[1]!.slice(4, 6));
  const expiration = `${(2000 + yy).toString().padStart(4, "0")}-${mm.toString().padStart(2, "0")}-${dd.toString().padStart(2, "0")}`;
  return { expiration, right: m[2] === "C" ? "C" : "P", strike: Number(m[3]!) / 1000 };
}

/** Drop Schwab sentinels (-999) and non-positive IVs. */
export function sanitizeOptionIv(iv: number | null | undefined): number | null {
  if (iv == null || !Number.isFinite(iv) || iv <= 0) return null;
  if (iv > 500) return null;
  return iv;
}

function dteFrom(expiration: string | null, asOf: string): number | null {
  if (!expiration) return null;
  const exp = new Date(`${expiration}T00:00:00Z`).getTime();
  const asOfMs = new Date(asOf).getTime();
  if (!Number.isFinite(exp) || !Number.isFinite(asOfMs)) return null;
  return Math.max(0, Math.ceil((exp - asOfMs) / (24 * 3600 * 1000)));
}

export function evaluateOptionRiskFlags(
  input: {
    quantity: number;
    right: "C" | "P" | null;
    strike: number | null;
    dte: number | null;
    delta: number | null;
    spot: number | null;
    coveringShares: number;
    pairedOppositeShort: boolean;
  },
  cfg: OptionRiskConfigs = DEFAULT_OPTION_RISK_CONFIGS,
): OptionRiskFlags {
  const short = input.quantity < 0;
  const contracts = Math.abs(input.quantity);
  const coveredCall =
    short && input.right === "C" && input.coveringShares + 1e-9 >= contracts * 100;
  const nakedCall = short && input.right === "C" && !coveredCall;
  const nakedPut = short && input.right === "P";
  const shortStrangle = (nakedCall || nakedPut) && input.pairedOppositeShort;

  let structure: OptionRiskFlags["structure"] = "other";
  if (shortStrangle) structure = "short-strangle";
  else if (coveredCall) structure = "covered-call";
  else if (nakedCall) structure = "naked-call";
  else if (nakedPut) structure = "naked-put";

  const undefinedRisk = nakedCall || shortStrangle;
  const nakedShort = nakedCall || nakedPut;
  const maxLoss: OptionRiskFlags["maxLoss"] = !short
    ? null
    : coveredCall || input.right === "P"
      ? "defined"
      : "unbounded";

  const absDelta = input.delta != null && Number.isFinite(input.delta) ? Math.abs(input.delta) : null;
  const lo = cfg.targetAbsDelta - cfg.deltaBand;
  const hi = cfg.targetAbsDelta + cfg.deltaBand;
  const deltaOffBand = short && absDelta != null && (absDelta < lo - 1e-9 || absDelta > hi + 1e-9);
  const shortDte = short && input.dte != null && input.dte <= cfg.maxDte;

  let itm = false;
  let assignmentNear = false;
  if (short && input.spot != null && input.strike != null && input.strike > 0) {
    const near = cfg.nearStrikePct;
    if (input.right === "C") {
      itm = input.spot > input.strike;
      assignmentNear = input.spot >= input.strike * (1 - near);
    } else if (input.right === "P") {
      itm = input.spot < input.strike;
      assignmentNear = input.spot <= input.strike * (1 + near);
    }
  }

  return {
    undefinedRisk,
    nakedShort,
    structure,
    maxLoss,
    absDelta,
    deltaOffBand,
    shortDte,
    assignmentNear,
    itm,
  };
}

export function loadOptionRiskSummary(
  db: Database.Database,
  opts?: {
    scope?: LatestSnapshotScope;
    flavor?: FlavorId;
    configs?: OptionRiskConfigs;
  },
): OptionRiskSummary {
  const cfg = opts?.configs ?? DEFAULT_OPTION_RISK_CONFIGS;
  const snaps = latestSnapshotIds(db, opts?.scope ?? "all_synced", opts?.flavor ?? "main");
  if (snaps.length === 0) {
    return { positions: [], undefinedRiskCount: 0, nakedShortCount: 0, marginPressure: [] };
  }

  const rows = db
    .prepare(
      `
      SELECT
        p.id AS positionId,
        a.id AS accountId,
        a.name AS accountName,
        hs.as_of AS asOf,
        s.symbol AS symbol,
        us.symbol AS underlyingSymbol,
        p.quantity AS quantity,
        p.price AS price,
        p.market_value AS marketValue,
        p.metadata_json AS metadataJson,
        og.delta AS delta,
        og.iv AS iv
      FROM positions p
      JOIN holding_snapshots hs ON hs.id = p.snapshot_id
      JOIN accounts a ON a.id = hs.account_id
      JOIN securities s ON s.id = p.security_id
      LEFT JOIN securities us ON us.id = s.underlying_security_id
      LEFT JOIN option_greeks og ON og.position_id = p.id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snapshots_json))
        AND s.security_type = 'option'
        AND ABS(p.quantity) > 1e-9
    `,
    )
    .all({ snapshots_json: JSON.stringify(snaps) }) as Array<{
    positionId: string;
    accountId: string;
    accountName: string;
    asOf: string;
    symbol: string | null;
    underlyingSymbol: string | null;
    quantity: number;
    price: number | null;
    marketValue: number | null;
    metadataJson: string | null;
    delta: number | null;
    iv: number | null;
  }>;

  const spots = db
    .prepare(
      `
      SELECT UPPER(TRIM(s.symbol)) AS symbol, SUM(p.quantity) AS qty, SUM(COALESCE(p.market_value, 0)) AS mv
      FROM positions p
      JOIN securities s ON s.id = p.security_id
      WHERE p.snapshot_id IN (SELECT value FROM json_each(@snapshots_json))
        AND s.security_type != 'option'
        AND s.security_type != 'cash'
        AND s.symbol IS NOT NULL
      GROUP BY UPPER(TRIM(s.symbol))
    `,
    )
    .all({ snapshots_json: JSON.stringify(snaps) }) as Array<{ symbol: string; qty: number; mv: number }>;
  const spotMap = new Map<string, number>();
  for (const r of spots) {
    if (r.qty && r.mv) spotMap.set(r.symbol, r.mv / r.qty);
  }

  const today = new Date().toISOString().slice(0, 10);
  const px = db
    .prepare(`SELECT UPPER(TRIM(symbol)) AS symbol, close FROM price_points WHERE provider = 'schwab' AND date = ?`)
    .all(today) as Array<{ symbol: string; close: number }>;
  for (const r of px) {
    if (Number.isFinite(r.close) && r.close > 0 && !spotMap.has(r.symbol)) spotMap.set(r.symbol, r.close);
  }

  // Fill remaining underlyings from latest OHLCV (prefer 5m, else 1d).
  const ohlcvNeeded = new Set<string>();
  for (const r of rows) {
    const u = normalizeOptionUnderlying(r.underlyingSymbol, r.symbol);
    if (u && !spotMap.has(u)) ohlcvNeeded.add(u);
  }
  const latestOhlcvClose = db.prepare(`
    SELECT close AS close
    FROM ohlcv_points
    WHERE provider = 'schwab' AND symbol = ? AND interval = ?
      AND close IS NOT NULL AND close > 0
    ORDER BY ts_ms DESC
    LIMIT 1
  `);
  for (const sym of ohlcvNeeded) {
    if (spotMap.has(sym)) continue;
    let close: number | null = null;
    const m5 = latestOhlcvClose.get(sym, "5m") as { close: number } | undefined;
    if (m5 && Number.isFinite(m5.close) && m5.close > 0) close = m5.close;
    else {
      const d1 = latestOhlcvClose.get(sym, "1d") as { close: number } | undefined;
      if (d1 && Number.isFinite(d1.close) && d1.close > 0) close = d1.close;
    }
    if (close != null) spotMap.set(sym, close);
  }

  type Draft = {
    positionId: string;
    accountId: string;
    accountName: string;
    symbol: string;
    underlying: string;
    quantity: number;
    right: "C" | "P" | null;
    strike: number | null;
    expiration: string | null;
    dte: number | null;
    delta: number | null;
    spot: number | null;
    avgPrice: number | null;
    markPrice: number | null;
    iv: number | null;
    coveringShares: number;
  };

  const drafts: Draft[] = rows.map((r) => {
    const parsed = parseOcc(r.symbol);
    const underlying = normalizeOptionUnderlying(r.underlyingSymbol, r.symbol);
    const coveringShares = longShareQuantityForUnderlying(db, r.accountId, underlying);
    const avgPrice = resolvePositionAveragePrice(r.price, r.metadataJson);
    const rawMark = optionMarkPerShare(r.marketValue, r.quantity);
    const markPrice =
      rawMark != null && Number.isFinite(rawMark) ? Math.abs(rawMark) : null;
    return {
      positionId: r.positionId,
      accountId: r.accountId,
      accountName: r.accountName,
      symbol: r.symbol ?? "",
      underlying,
      quantity: r.quantity,
      right: parsed?.right ?? null,
      strike: parsed?.strike ?? null,
      expiration: parsed?.expiration ?? null,
      dte: dteFrom(parsed?.expiration ?? null, r.asOf),
      delta: r.delta,
      spot: spotMap.get(underlying) ?? null,
      avgPrice,
      markPrice,
      iv: sanitizeOptionIv(r.iv),
      coveringShares,
    };
  });

  const shortKeys = new Set<string>();
  for (const d of drafts) {
    if (d.quantity < 0 && d.right) shortKeys.add(`${d.accountId}|${d.underlying}|${d.right}`);
  }

  const positions: OptionRiskPosition[] = drafts.map((d) => {
    const opposite = d.right === "C" ? "P" : d.right === "P" ? "C" : null;
    const pairedOppositeShort = opposite
      ? shortKeys.has(`${d.accountId}|${d.underlying}|${opposite}`)
      : false;
    const flags = evaluateOptionRiskFlags(
      {
        quantity: d.quantity,
        right: d.right,
        strike: d.strike,
        dte: d.dte,
        delta: d.delta,
        spot: d.spot,
        coveringShares: d.coveringShares,
        pairedOppositeShort,
      },
      cfg,
    );
    const perShare =
      d.spot != null && d.strike != null && d.right
        ? d.right === "C"
          ? Math.max(0, d.spot - d.strike)
          : Math.max(0, d.strike - d.spot)
        : null;
    const intrinsic = perShare != null ? perShare * 100 * Math.abs(d.quantity) : null;
    return {
      positionId: d.positionId,
      accountId: d.accountId,
      accountName: d.accountName,
      symbol: d.symbol,
      underlying: d.underlying,
      quantity: d.quantity,
      right: d.right,
      strike: d.strike,
      expiration: d.expiration,
      dte: d.dte,
      delta: d.delta,
      spot: d.spot,
      intrinsic,
      marginSecured: optionMarginSecuredDollars(d.quantity, d.strike),
      avgPrice: d.avgPrice,
      markPrice: d.markPrice,
      iv: d.iv,
      flags,
    };
  });

  const equityRows = db
    .prepare(
      `
      SELECT av.account_id AS accountId, av.equity_value AS equity
      FROM account_value_points av
      JOIN (
        SELECT account_id, MAX(as_of) AS max_as_of
        FROM account_value_points
        GROUP BY account_id
      ) latest ON latest.account_id = av.account_id AND latest.max_as_of = av.as_of
    `,
    )
    .all() as Array<{ accountId: string; equity: number }>;
  const equityMap = new Map(equityRows.map((r) => [r.accountId, r.equity]));

  const byAccount = new Map<string, { accountName: string; margin: number }>();
  for (const p of positions) {
    if (p.quantity >= 0 || p.marginSecured == null) continue;
    const cur = byAccount.get(p.accountId) ?? { accountName: p.accountName, margin: 0 };
    cur.margin += p.marginSecured;
    byAccount.set(p.accountId, cur);
  }
  const marginPressure = [...byAccount.entries()].map(([accountId, v]) => {
    const equity = equityMap.get(accountId) ?? null;
    const marginPct = equity && equity > 0 ? v.margin / equity : null;
    return {
      accountId,
      accountName: v.accountName,
      marginSecured: v.margin,
      equity,
      marginPct,
      breached: marginPct != null && marginPct >= cfg.maxMarginPct,
    };
  });

  return {
    positions,
    undefinedRiskCount: positions.filter((p) => p.flags.undefinedRisk).length,
    nakedShortCount: positions.filter((p) => p.flags.nakedShort).length,
    marginPressure,
  };
}

export type OptionRiskEventDraft = {
  ruleType: OptionRiskRuleType;
  severity: "info" | "warning" | "critical";
  title: string;
  details: unknown;
};

export function optionRiskEventsFromSummary(
  summary: OptionRiskSummary,
  enabled: Set<OptionRiskRuleType>,
): OptionRiskEventDraft[] {
  const events: OptionRiskEventDraft[] = [];
  for (const p of summary.positions) {
    if (enabled.has("undefined-risk") && p.flags.undefinedRisk) {
      events.push({
        ruleType: "undefined-risk",
        severity: "critical",
        title: `Undefined risk ${p.flags.structure} ${p.underlying}: max loss unbounded`,
        details: p,
      });
    }
    if (enabled.has("naked-short") && p.flags.nakedShort) {
      events.push({
        ruleType: "naked-short",
        severity: p.flags.undefinedRisk ? "critical" : "warning",
        title: `Naked short ${p.right === "P" ? "put" : "call"} ${p.underlying}`,
        details: p,
      });
    }
    if (enabled.has("delta-band") && p.flags.deltaOffBand) {
      events.push({
        ruleType: "delta-band",
        severity: "warning",
        title: `${p.underlying} |Δ|=${p.flags.absDelta?.toFixed(2)} off ~0.15 band`,
        details: p,
      });
    }
    if (enabled.has("option-dte") && p.flags.shortDte) {
      events.push({
        ruleType: "option-dte",
        severity: (p.dte ?? 99) <= 7 ? "critical" : "warning",
        title: `${p.underlying} short option ${p.dte} DTE`,
        details: p,
      });
    }
    if (enabled.has("assignment") && p.flags.assignmentNear) {
      events.push({
        ruleType: "assignment",
        severity: p.flags.itm ? "critical" : "warning",
        title: `${p.underlying} assignment proximity (${p.flags.itm ? "ITM" : "near strike"})`,
        details: p,
      });
    }
  }
  if (enabled.has("margin-pressure")) {
    for (const m of summary.marginPressure) {
      if (!m.breached) continue;
      events.push({
        ruleType: "margin-pressure",
        severity: (m.marginPct ?? 0) >= 0.4 ? "critical" : "warning",
        title: `Margin pressure ${m.accountName}: ${((m.marginPct ?? 0) * 100).toFixed(1)}% of equity`,
        details: m,
      });
    }
  }
  return events;
}
