import type { ContractQuote, OptionChain } from "@/lib/optionChain/chain";

/** Dollar and percent move implied by the nearest-expiry at-the-money straddle. */
export type ExpectedMove = {
  symbol: string;
  spot: number;
  expiry: string;
  strike: number;
  callMid: number;
  putMid: number;
  moveDollars: number;
  movePct: number;
  /** Average of the call and put feed IVs, when the chain printed them. Decimal, not a rank. */
  atmIv: number | null;
  source: OptionChain["provenance"]["source"];
  servedFrom: OptionChain["provenance"]["servedFrom"];
  delayed: boolean;
};

function usableMid(quote: ContractQuote | null): number | null {
  if (!quote) return null;
  if (quote.mid != null && quote.mid > 0) return quote.mid;
  if (quote.bid != null && quote.ask != null && quote.bid >= 0 && quote.ask > 0) return (quote.bid + quote.ask) / 2;
  return null;
}

function averageIv(call: ContractQuote | null, put: ContractQuote | null): number | null {
  const ivs = [call?.feedIv, put?.feedIv].filter((n): n is number => n != null && n > 0);
  if (ivs.length === 0) return null;
  return ivs.reduce((sum, n) => sum + n, 0) / ivs.length;
}

/**
 * Nearest listed expiry on or after the chain's trade date, at the strike closest to spot,
 * using the call mid plus the put mid. That sum is the option-implied expected move.
 */
export function expectedMoveFromChain(chain: OptionChain): ExpectedMove | null {
  if (!(chain.spot > 0)) return null;
  const expiries = chain.expiries.filter((expiry) => expiry.date >= chain.tradeDate);
  for (const expiry of expiries) {
    let best: { strike: number; distance: number; call: number; put: number; iv: number | null } | null = null;
    for (const row of expiry.strikes) {
      const call = usableMid(row.call);
      const put = usableMid(row.put);
      if (call == null || put == null) continue;
      const distance = Math.abs(row.strike - chain.spot);
      const closer = best == null || distance < best.distance - 1e-9;
      const tie = best != null && Math.abs(distance - best.distance) <= 1e-9 && row.strike < best.strike;
      if (closer || tie) {
        best = { strike: row.strike, distance, call, put, iv: averageIv(row.call, row.put) };
      }
    }
    if (!best) continue;
    return {
      symbol: chain.symbol,
      spot: chain.spot,
      expiry: expiry.date,
      strike: best.strike,
      callMid: best.call,
      putMid: best.put,
      moveDollars: best.call + best.put,
      movePct: (best.call + best.put) / chain.spot,
      atmIv: best.iv,
      source: chain.provenance.source,
      servedFrom: chain.provenance.servedFrom,
      delayed: chain.provenance.delayed,
    };
  }
  return null;
}
