import { schwabMarketFetch } from "@/lib/schwab/client";

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function asObj(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" ? (v as Record<string, unknown>) : null;
}

function getString(o: Record<string, unknown> | null, key: string): string | null {
  if (!o) return null;
  const v = o[key];
  return typeof v === "string" ? v : null;
}

function pickString(o: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const s = getString(o, key)?.trim();
    if (!s) continue;
    const low = s.toLowerCase();
    if (low === "n/a" || low === "na" || low === "unknown" || low === "other") continue;
    return s;
  }
  return null;
}

function pickNumber(o: Record<string, unknown>, keys: string[]): number | null {
  for (const key of keys) {
    const v = asNumber(o[key]);
    if (v != null && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

function normalizeDivYield(v: number | null): number | null {
  if (v == null || !Number.isFinite(v)) return null;
  if (v > 1 && v <= 100) return v / 100;
  return v >= 0 ? v : null;
}

export type SchwabCompanyPayload = {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  pe: number | null;
  divYield: number | null;
  beta: number | null;
  week52High: number | null;
  week52Low: number | null;
  avgVol: number | null;
  raw: Record<string, unknown>;
};

export function parseSchwabInstrumentFundamental(resp: unknown, symbol: string): Omit<SchwabCompanyPayload, "symbol"> {
  const symU = normSym(symbol);
  const root = asObj(resp);
  const entry = root ? (asObj(root[symU]) ?? asObj(root[symbol]) ?? asObj(root[symbol.toUpperCase()])) : null;
  const fundamental =
    (entry
      ? asObj((entry as Record<string, unknown>)["fundamental"]) ??
        asObj((entry as Record<string, unknown>)["fundamentals"]) ??
        entry
      : null) ?? {};

  const companyName =
    getString(fundamental, "companyName") ??
    getString(entry, "description") ??
    getString(fundamental, "description") ??
    null;

  return {
    companyName,
    sector: pickString(fundamental, ["sector", "Sector"]),
    industry: pickString(fundamental, ["industry", "Industry"]),
    marketCap: pickNumber(fundamental, ["marketCap", "marketCapitalization", "market_cap"]),
    pe: pickNumber(fundamental, ["peRatio", "pe", "trailingPE", "forwardPE"]),
    divYield: normalizeDivYield(
      pickNumber(fundamental, ["divYield", "dividendYield", "divYieldTTM", "yield"]),
    ),
    beta: pickNumber(fundamental, ["beta", "Beta"]),
    week52High: pickNumber(fundamental, ["high52", "fiftyTwoWeekHigh", "52WeekHigh", "week52High"]),
    week52Low: pickNumber(fundamental, ["low52", "fiftyTwoWeekLow", "52WeekLow", "week52Low"]),
    avgVol: pickNumber(fundamental, ["volAvg", "averageVolume", "avgVolume", "averageDailyVolume3Month"]),
    raw: fundamental,
  };
}

export async function fetchSchwabInstrumentFundamental(symbol: string): Promise<SchwabCompanyPayload> {
  const sym = normSym(symbol);
  const resp = await schwabMarketFetch<unknown>(
    `/instruments?symbol=${encodeURIComponent(sym)}&projection=fundamental`,
  );
  const parsed = parseSchwabInstrumentFundamental(resp, sym);
  return { symbol: sym, ...parsed };
}
