export type StrategyTradeApiRow = {
  id: string;
  accountId: string;
  accountName: string;
  symbol: string | null;
  underlyingSymbol: string | null;
  securityType: "equity" | "option" | "unknown";
  entryDate: string;
  exitDate: string | null;
  quantity: number | null;
  entryPrice: number | null;
  exitOrCurrentPrice: number | null;
  pnlDollars: number | null;
  pnlPct: number | null;
  pctGain: number | null;
  description: string | null;
  legCount: number;
  transactionType: string | null;
  /** Set when listing all strategies; classification slug from DB. */
  strategyCategory?: string | null;
};

export type StrategyStats = {
  totalTrades: number;
  winRate: number | null;
  totalPnl: number | null;
  avgPnlPerTrade: number | null;
  avgPctReturn: number | null;
  largestWinner: { symbol: string; pnl: number } | null;
  largestLoser: { symbol: string; pnl: number } | null;
  sharpeRatio: number | null;
};

function mean(xs: number[]): number | null {
  if (!xs.length) return null;
  return xs.reduce((a, b) => a + b, 0) / xs.length;
}

function stdev(xs: number[]): number | null {
  if (xs.length < 2) return null;
  const m = mean(xs);
  if (m == null) return null;
  const v = xs.reduce((s, x) => s + (x - m) * (x - m), 0) / (xs.length - 1);
  return Math.sqrt(v);
}

export function computeStrategyStats(rows: StrategyTradeApiRow[]): StrategyStats {
  const pnls = rows.map((r) => r.pnlDollars).filter((x): x is number => x != null && Number.isFinite(x));
  const pcts = rows.map((r) => r.pnlPct).filter((x): x is number => x != null && Number.isFinite(x));

  const wins = rows.filter((r) => r.pnlDollars != null && Number.isFinite(r.pnlDollars) && r.pnlDollars > 0).length;
  const totalTrades = rows.length;
  const winRate = totalTrades > 0 ? (wins / totalTrades) * 100 : null;

  const totalPnl = pnls.length ? pnls.reduce((a, b) => a + b, 0) : null;
  const avgPnlPerTrade = pnls.length ? mean(pnls) : null;
  const avgPctReturn = pcts.length ? mean(pcts) : null;

  let largestWinner: { symbol: string; pnl: number } | null = null;
  let largestLoser: { symbol: string; pnl: number } | null = null;
  for (const r of rows) {
    if (r.pnlDollars == null || !Number.isFinite(r.pnlDollars)) continue;
    const sym = r.symbol ?? r.underlyingSymbol ?? "—";
    if (largestWinner == null || r.pnlDollars > largestWinner.pnl) largestWinner = { symbol: sym, pnl: r.pnlDollars };
    if (largestLoser == null || r.pnlDollars < largestLoser.pnl) largestLoser = { symbol: sym, pnl: r.pnlDollars };
  }

  let sharpeRatio: number | null = null;
  if (pcts.length >= 3) {
    const m = mean(pcts);
    const s = stdev(pcts);
    if (m != null && s != null && s > 1e-9) sharpeRatio = m / s;
  }

  return {
    totalTrades,
    winRate,
    totalPnl,
    avgPnlPerTrade,
    avgPctReturn,
    largestWinner,
    largestLoser,
    sharpeRatio,
  };
}

export function notionalForPnlPct(
  quantity: number | null,
  price: number | null,
  assetType: string | null,
): number | null {
  if (quantity == null || price == null || !Number.isFinite(quantity) || !Number.isFinite(price)) return null;
  const mult = (assetType ?? "").toUpperCase() === "OPTION" ? 100 : 1;
  const n = Math.abs(quantity * price * mult);
  return n > 0 ? n : null;
}
