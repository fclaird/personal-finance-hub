/** User-defined watch alerts. Evaluation is pure; storage and quotes are supplied by the caller. */

export type WatchAlertKind = "price" | "iv-spike" | "profit-target";

export type PriceAlertConfig = { direction: "above" | "below"; level: number };
export type IvSpikeConfig = { minRankPct: number };
export type ProfitTargetConfig = { targetPnl: number; expiry?: string };

export type WatchAlert = {
  id: string;
  kind: WatchAlertKind;
  symbol: string;
  enabled: boolean;
  config: PriceAlertConfig | IvSpikeConfig | ProfitTargetConfig;
};

export type WatchQuote = {
  symbol: string;
  last: number | null;
  ivRankPct: number | null;
};

export type SymbolPnl = {
  symbol: string;
  pnl: number | null;
};

export type SpreadPnl = {
  symbol: string;
  expiry: string;
  pnl: number | null;
};

export type WatchFiring = {
  alertId: string;
  symbol: string;
  severity: "warning";
  title: string;
  details: Record<string, unknown>;
};

function symbolKey(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function isPrice(config: WatchAlert["config"]): config is PriceAlertConfig {
  return "direction" in config && "level" in config;
}

function isIv(config: WatchAlert["config"]): config is IvSpikeConfig {
  return "minRankPct" in config;
}

function isProfit(config: WatchAlert["config"]): config is ProfitTargetConfig {
  return "targetPnl" in config;
}

/** Fire when the quote or position P&L has crossed the user's line. Missing inputs stay quiet. */
export function evaluateWatchAlerts(
  alerts: readonly WatchAlert[],
  quotes: readonly WatchQuote[],
  pnls: readonly SymbolPnl[],
  spreads: readonly SpreadPnl[] = [],
): WatchFiring[] {
  const quoteBySymbol = new Map(quotes.map((quote) => [symbolKey(quote.symbol), quote]));
  const pnlBySymbol = new Map(pnls.map((row) => [symbolKey(row.symbol), row.pnl]));
  const spreadByKey = new Map(spreads.map((row) => [`${symbolKey(row.symbol)}|${row.expiry}`, row.pnl]));
  const firings: WatchFiring[] = [];
  for (const alert of alerts) {
    if (!alert.enabled) continue;
    const symbol = symbolKey(alert.symbol);
    if (!symbol) continue;
    const quote = quoteBySymbol.get(symbol);
    if (alert.kind === "price" && isPrice(alert.config)) {
      const last = quote?.last ?? null;
      if (last == null) continue;
      const hit = alert.config.direction === "above" ? last >= alert.config.level : last <= alert.config.level;
      if (!hit) continue;
      const side = alert.config.direction === "above" ? "at or above" : "at or below";
      firings.push({
        alertId: alert.id,
        symbol,
        severity: "warning",
        title: `${symbol} ${side} ${alert.config.level}`,
        details: { kind: alert.kind, last, level: alert.config.level, direction: alert.config.direction },
      });
    }
    if (alert.kind === "iv-spike" && isIv(alert.config)) {
      const rank = quote?.ivRankPct ?? null;
      if (rank == null || !(rank >= alert.config.minRankPct)) continue;
      firings.push({
        alertId: alert.id,
        symbol,
        severity: "warning",
        title: `${symbol} IV rank ${rank.toFixed(0)}% is at least ${alert.config.minRankPct}%`,
        details: { kind: alert.kind, ivRankPct: rank, minRankPct: alert.config.minRankPct },
      });
    }
    if (alert.kind === "profit-target" && isProfit(alert.config)) {
      const expiry = alert.config.expiry;
      const pnl = expiry ? (spreadByKey.get(`${symbol}|${expiry}`) ?? null) : (pnlBySymbol.get(symbol) ?? null);
      if (pnl == null || !(pnl >= alert.config.targetPnl)) continue;
      const scope = expiry ? `${expiry} spread` : "open";
      firings.push({
        alertId: alert.id,
        symbol,
        severity: "warning",
        title: `${symbol} ${scope} P&L ${pnl.toFixed(2)} reached ${alert.config.targetPnl}`,
        details: { kind: alert.kind, pnl, targetPnl: alert.config.targetPnl, expiry: expiry ?? null },
      });
    }
  }
  return firings;
}

export type PnlPosition = {
  underlying: string;
  securityType: string;
  quantity: number;
  averagePrice: number | null;
  marketValue: number | null;
  quote: number | null;
  expiry?: string | null;
};

/** Equity P&L uses the live quote. Option P&L uses Schwab average price and position market value. */
export function pnlByUnderlying(rows: readonly PnlPosition[]): SymbolPnl[] {
  const totals = new Map<string, { pnl: number; priced: boolean }>();
  for (const row of rows) {
    const symbol = symbolKey(row.underlying);
    if (!symbol || row.quantity === 0) continue;
    let pnl: number | null = null;
    if (row.securityType === "option") {
      if (row.averagePrice != null && row.marketValue != null) {
        const cost = row.averagePrice * row.quantity * 100;
        pnl = row.marketValue - cost;
      }
    } else if (row.quote != null && row.averagePrice != null) {
      pnl = (row.quote - row.averagePrice) * row.quantity;
    }
    const prev = totals.get(symbol) ?? { pnl: 0, priced: false };
    if (pnl == null) {
      totals.set(symbol, prev);
      continue;
    }
    totals.set(symbol, { pnl: prev.pnl + pnl, priced: true });
  }
  return [...totals.entries()].map(([symbol, row]) => ({ symbol, pnl: row.priced ? row.pnl : null }));
}

/** Option legs that share an underlying and an expiry are one spread. Equity rows are left out. */
export function pnlBySpread(rows: readonly PnlPosition[]): SpreadPnl[] {
  const groups = new Map<string, { symbol: string; expiry: string; pnl: number; priced: boolean }>();
  for (const row of rows) {
    if (row.securityType !== "option") continue;
    const symbol = symbolKey(row.underlying);
    const expiry = (row.expiry ?? "").slice(0, 10);
    if (!symbol || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) continue;
    let pnl: number | null = null;
    if (row.averagePrice != null && row.marketValue != null) {
      pnl = row.marketValue - row.averagePrice * row.quantity * 100;
    }
    const key = `${symbol}|${expiry}`;
    const prev = groups.get(key) ?? { symbol, expiry, pnl: 0, priced: false };
    if (pnl == null) {
      groups.set(key, prev);
      continue;
    }
    groups.set(key, { symbol, expiry, pnl: prev.pnl + pnl, priced: true });
  }
  return [...groups.values()]
    .map((row) => ({ symbol: row.symbol, expiry: row.expiry, pnl: row.priced ? row.pnl : null }))
    .sort((a, b) => a.expiry.localeCompare(b.expiry) || a.symbol.localeCompare(b.symbol));
}
