import type { ChainDraft, DraftContract, OptionRight } from "@/lib/optionChain/chain";
import { parseOptionFromSchwabSymbol } from "@/lib/strategy/optionParse";
import { nyYmd } from "@/lib/market/usEquitySession";

function num(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
  if (raw <= -100) return null;
  return raw;
}

function countField(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw) || raw < 0) return null;
  return Math.round(raw);
}

function feedIv(raw: unknown): number | null {
  const n = num(raw);
  if (n == null || n <= 0) return null;
  return n > 3 ? n / 100 : n;
}

function yieldHint(raw: unknown): number | null {
  const n = num(raw);
  if (n == null || n < 0) return null;
  if (n === 0) return 0;
  return n > 0.2 ? n / 100 : n;
}

function asRecord(raw: unknown): Record<string, unknown> | null {
  return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : null;
}

function expiryFromKey(key: string): string | null {
  const date = key.split(":")[0] ?? "";
  return /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
}

function spotOf(root: Record<string, unknown>): number | null {
  const direct = num(root.underlyingPrice);
  if (direct != null && direct > 0) return direct;
  const underlying = asRecord(root.underlying);
  if (!underlying) return null;
  for (const key of ["mark", "last", "bid", "ask", "close"]) {
    const n = num(underlying[key]);
    if (n != null && n > 0) return n;
  }
  return null;
}

/** Schwab `/chains` JSON → draft rows. Returns null when the body is not a chain. */
export function parseSchwabChain(symbol: string, body: unknown, fetchedAt: string): ChainDraft | null {
  const root = asRecord(body);
  if (!root) return null;
  const callMap = asRecord(root.callExpDateMap);
  const putMap = asRecord(root.putExpDateMap);
  if (!callMap && !putMap) return null;
  const spot = spotOf(root);
  if (spot == null) return null;

  const contracts: DraftContract[] = [];
  const walk = (map: Record<string, unknown> | null, fallbackRight: OptionRight) => {
    if (!map) return;
    for (const [key, strikeMapRaw] of Object.entries(map)) {
      const expiry = expiryFromKey(key);
      const strikeMap = asRecord(strikeMapRaw);
      if (!expiry || !strikeMap) continue;
      for (const contractsRaw of Object.values(strikeMap)) {
        if (!Array.isArray(contractsRaw)) continue;
        for (const item of contractsRaw) {
          const c = asRecord(item);
          if (!c) continue;
          const parsed = parseOptionFromSchwabSymbol(typeof c.symbol === "string" ? c.symbol : null);
          const right: OptionRight =
            c.putCall === "CALL" || c.putCall === "PUT" ? (c.putCall === "CALL" ? "C" : "P") : (parsed?.right ?? fallbackRight);
          const strike = num(c.strikePrice) ?? parsed?.strike ?? null;
          if (strike == null) continue;
          const multiplier = num(c.multiplier);
          const optionRoot = typeof c.optionRoot === "string" ? c.optionRoot : (parsed?.underlying ?? null);
          contracts.push({
            expiry: parsed?.expiration ?? expiry,
            right,
            strike,
            bid: num(c.bid),
            ask: num(c.ask),
            feedIv: feedIv(c.volatility),
            openInterest: countField(c.openInterest),
            volume: countField(c.totalVolume),
            multiplier,
            root: optionRoot,
          });
        }
      }
    }
  };
  walk(callMap, "C");
  walk(putMap, "P");

  const quoteTime = typeof asRecord(root.underlying)?.quoteTime === "number"
    ? new Date(asRecord(root.underlying)!.quoteTime as number).toISOString()
    : null;
  const tradeDate = quoteTime ? nyYmd(new Date(quoteTime)) : nyYmd(new Date(fetchedAt));

  return {
    symbol,
    spot,
    tradeDate,
    quoteTime,
    source: "schwab",
    delayed: root.isDelayed === true,
    dividendYieldHint: yieldHint(root.dividendYield),
    contracts,
    fetchedAt,
    servedFrom: "network",
    fallbackFrom: null,
  };
}
