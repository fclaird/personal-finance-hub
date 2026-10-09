import type { ChainDraft, DraftContract } from "@/lib/optionChain/chain";
import { nyYmd } from "@/lib/market/usEquitySession";
import { parseOptionFromSchwabSymbol } from "@/lib/strategy/optionParse";

function num(raw: unknown): number | null {
  if (typeof raw !== "number" || !Number.isFinite(raw)) return null;
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

/** Cboe prints "NOW290119C00120000". The OCC parser wants a space before the date. */
export function cboeOccToSchwabSymbol(option: string): string | null {
  const m = option.trim().toUpperCase().match(/^([A-Z0-9.]+?)(\d{6}[CP]\d{8})$/);
  if (!m) return null;
  return `${m[1]} ${m[2]}`;
}

function quoteInstant(timestamp: string): Date | null {
  const m = timestamp.trim().match(/^(\d{4}-\d{2}-\d{2})[ T](\d{2}:\d{2}:\d{2})$/);
  if (!m) {
    const parsed = Date.parse(timestamp);
    return Number.isFinite(parsed) ? new Date(parsed) : null;
  }
  return new Date(`${m[1]}T${m[2]}Z`);
}

/** Cboe delayed quotes JSON → draft rows. Returns null when the body is not a chain. */
export function parseCboeChain(symbol: string, body: unknown, fetchedAt: string): ChainDraft | null {
  if (!body || typeof body !== "object") return null;
  const root = body as Record<string, unknown>;
  const data = root.data && typeof root.data === "object" ? (root.data as Record<string, unknown>) : null;
  if (!data || !Array.isArray(data.options)) return null;
  const spot = num(data.current_price);
  if (spot == null || !(spot > 0)) return null;

  const contracts: DraftContract[] = [];
  for (const item of data.options) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.option !== "string") continue;
    const spaced = cboeOccToSchwabSymbol(row.option);
    const parsed = parseOptionFromSchwabSymbol(spaced);
    if (!parsed) continue;
    contracts.push({
      expiry: parsed.expiration,
      right: parsed.right,
      strike: parsed.strike,
      bid: num(row.bid),
      ask: num(row.ask),
      feedIv: feedIv(row.iv),
      openInterest: countField(row.open_interest ?? row.openInterest),
      volume: countField(row.volume),
      multiplier: null,
      root: parsed.underlying,
    });
  }

  const timestamp = typeof root.timestamp === "string" ? root.timestamp : null;
  const instant = timestamp ? quoteInstant(timestamp) : null;
  const tradeDate = nyYmd(instant ?? new Date(fetchedAt));

  return {
    symbol,
    spot,
    tradeDate,
    quoteTime: instant ? instant.toISOString() : null,
    source: "cboe",
    delayed: true,
    dividendYieldHint: null,
    contracts,
    fetchedAt,
    servedFrom: "network",
    fallbackFrom: null,
  };
}
