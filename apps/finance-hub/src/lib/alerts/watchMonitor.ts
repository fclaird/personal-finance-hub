/** Assemble the watchlist board from quotes and stored IV rank. ATM IV is separate from rank. */

export type MonitorQuote = {
  symbol: string;
  last: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
};

export type MonitorRow = {
  symbol: string;
  last: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  ivRankPct: number | null;
  atmIv: number | null;
};

export function assembleMonitorRows(
  symbols: readonly string[],
  quotes: readonly MonitorQuote[],
  ivRankBySymbol: ReadonlyMap<string, number | null>,
  atmIvBySymbol: ReadonlyMap<string, number | null>,
): MonitorRow[] {
  const quoteBySymbol = new Map(quotes.map((quote) => [quote.symbol.trim().toUpperCase(), quote]));
  return [...new Set(symbols.map((symbol) => symbol.trim().toUpperCase()).filter(Boolean))]
    .sort((a, b) => a.localeCompare(b))
    .map((symbol) => {
      const quote = quoteBySymbol.get(symbol);
      return {
        symbol,
        last: quote?.last ?? null,
        change: quote?.change ?? null,
        changePercent: quote?.changePercent ?? null,
        volume: quote?.volume ?? null,
        ivRankPct: ivRankBySymbol.get(symbol) ?? null,
        atmIv: atmIvBySymbol.get(symbol) ?? null,
      };
    });
}
