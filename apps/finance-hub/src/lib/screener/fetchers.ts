import { execFile } from "node:child_process";
import path from "node:path";
import { promisify } from "node:util";

import type Database from "better-sqlite3";

import { fetchYahooDailyChart, yahooChartSymbol } from "@/lib/market/yahooChartFetch";
import { lookupSecCompanyCik } from "@/lib/openData/secCompanyTickers";
import { secFetchText } from "@/lib/sec/secFetch";
import { fetchSchwabInstrumentFundamental } from "@/lib/schwab/instrumentFundamental";
import { getSchwabToken } from "@/lib/schwab/token";
import { parseYahooChartBars } from "@/lib/screener/parseLive";
import {
  parseAlphaOverview,
  parseFinnhubMetric,
  parseFmpRatios,
  parseSchwabFundamentals,
  parseSecCompanyFacts,
  parseYahooQuoteSummary,
} from "@/lib/screener/parseLive";
import { cacheGet, cacheSet, quotaAdd, quotaCount } from "@/lib/screener/store";
import type { ObservationInput } from "@/lib/screener/types";
import { getAppDataDir } from "@/lib/paths";
import { ensureDirSync } from "@/lib/fs";

const execFileAsync = promisify(execFile);

export type SourceAttempt = {
  source: string;
  status: "ok" | "skipped" | "failed";
  detail?: string;
  observations: ObservationInput[];
};

export const FINNHUB_ENV = "FINNHUB_API_KEY";
export const FMP_ENV = "FMP_API_KEY";
export const ALPHA_VANTAGE_ENV = "ALPHA_VANTAGE_API_KEY";

const ALPHA_DAILY_CAP = 25;

function envKey(name: string): string | null {
  const value = process.env[name]?.trim();
  return value ? value : null;
}

function fail(source: string, error: unknown): SourceAttempt {
  const detail = error instanceof Error ? error.message : String(error);
  return { source, status: "failed", detail: detail.slice(0, 300), observations: [] };
}

async function cachedJson(
  db: Database.Database,
  key: string,
  ttlMs: number,
  loader: () => Promise<string | null>,
): Promise<unknown | null> {
  const now = Date.now();
  const hit = cacheGet(db, key, now);
  const text = hit ?? (await loader());
  if (!text) return null;
  if (!hit) {
    const fetchedAt = new Date(now).toISOString();
    cacheSet(db, key, text, fetchedAt, new Date(now + ttlMs).toISOString());
  }
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return null;
  }
}

let yahooCrumbCache: { crumb: string; jar: string; at: number } | null = null;

async function yahooCrumb(): Promise<{ crumb: string; jar: string } | null> {
  if (yahooCrumbCache && Date.now() - yahooCrumbCache.at < 30 * 60 * 1000) {
    return yahooCrumbCache;
  }
  try {
    ensureDirSync(getAppDataDir());
    const jar = path.join(getAppDataDir(), "screener-yahoo-cookies.txt");
    await execFileAsync("curl", ["-sS", "-c", jar, "-A", "Mozilla/5.0", "-o", "/dev/null", "https://fc.yahoo.com"], {
      timeout: 20_000,
    }).catch(() => undefined);
    const { stdout } = await execFileAsync(
      "curl",
      ["-sS", "-b", jar, "-c", jar, "-A", "Mozilla/5.0", "https://query1.finance.yahoo.com/v1/test/getcrumb"],
      { timeout: 20_000 },
    );
    const crumb = String(stdout ?? "").trim();
    if (!crumb || crumb.includes(" ") || crumb.length > 40) return null;
    yahooCrumbCache = { crumb, jar, at: Date.now() };
    return yahooCrumbCache;
  } catch {
    return null;
  }
}

export async function pullYahooSummary(db: Database.Database, ticker: string): Promise<SourceAttempt> {
  try {
    const symbol = yahooChartSymbol(ticker);
    const json = await cachedJson(db, `yahoo:summary:${symbol}`, 12 * 60 * 60 * 1000, async () => {
      const session = await yahooCrumb();
      if (!session) return null;
      const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(symbol)}?modules=defaultKeyStatistics,financialData,assetProfile,earningsTrend,price&crumb=${encodeURIComponent(session.crumb)}`;
      try {
        const { stdout } = await execFileAsync(
          "curl",
          ["-sS", "-b", session.jar, "-A", "Mozilla/5.0", "-H", "Accept: application/json", url],
          { timeout: 20_000, maxBuffer: 4 * 1024 * 1024 },
        );
        const text = String(stdout ?? "").trim();
        if (!text || text.startsWith("Too Many") || text.includes("Unauthorized")) return null;
        return text;
      } catch {
        return null;
      }
    });
    if (!json) return { source: "yahoo", status: "failed", detail: "Yahoo quoteSummary returned nothing", observations: [] };
    const observations = parseYahooQuoteSummary(json, new Date().toISOString());
    if (observations.length === 0) return { source: "yahoo", status: "failed", detail: "Yahoo quoteSummary had no cited fields", observations: [] };
    return { source: "yahoo", status: "ok", observations };
  } catch (error) {
    return fail("yahoo", error);
  }
}

export async function pullYahooAdjustedCloses(db: Database.Database, symbol: string): Promise<Array<{ date: string; adjClose: number }> | null> {
  const yahooSymbol = yahooChartSymbol(symbol);
  try {
    const json = await cachedJson(db, `yahoo:chart:${yahooSymbol}:10y`, 12 * 60 * 60 * 1000, async () => {
      const fetched = await fetchYahooDailyChart(yahooSymbol, "10y");
      if (!fetched) return null;
      return JSON.stringify({ chart: { result: [fetched.result] } });
    });
    if (!json) return null;
    const bars = parseYahooChartBars(json);
    return bars.length > 0 ? bars : null;
  } catch {
    return null;
  }
}

export async function pullSchwab(ticker: string): Promise<SourceAttempt> {
  const passphrase = envKey("FINANCE_HUB_PASSPHRASE");
  if (!passphrase) return { source: "schwab", status: "skipped", detail: "FINANCE_HUB_PASSPHRASE is not set", observations: [] };
  try {
    if (!getSchwabToken(passphrase)) return { source: "schwab", status: "skipped", detail: "Schwab is not connected", observations: [] };
  } catch {
    return { source: "schwab", status: "skipped", detail: "Schwab is not connected", observations: [] };
  }
  const symbols = [ticker.trim().toUpperCase()];
  if (symbols[0]!.includes("-")) symbols.push(symbols[0]!.replace(/-/g, "/"));
  let detail = "No fundamental fields";
  for (const symbol of symbols) {
    try {
      const payload = await fetchSchwabInstrumentFundamental(symbol);
      const observations = parseSchwabFundamentals(payload, new Date().toISOString());
      if (observations.length > 0) return { source: "schwab", status: "ok", observations };
    } catch (error) {
      detail = error instanceof Error ? error.message : String(error);
      if (detail.toLowerCase().includes("not connected")) {
        return { source: "schwab", status: "skipped", detail, observations: [] };
      }
    }
  }
  return { source: "schwab", status: "failed", detail: detail.slice(0, 300), observations: [] };
}

let finnhubNextAt = 0;

export async function pullFinnhub(db: Database.Database, ticker: string): Promise<SourceAttempt> {
  const token = envKey(FINNHUB_ENV);
  if (!token) return { source: "finnhub", status: "skipped", detail: `${FINNHUB_ENV} is not set`, observations: [] };
  try {
    const symbol = ticker.trim().toUpperCase();
    const json = await cachedJson(db, `finnhub:metric:${symbol}`, 12 * 60 * 60 * 1000, async () => {
      const wait = finnhubNextAt - Date.now();
      if (wait > 0) await new Promise((resolve) => setTimeout(resolve, wait));
      finnhubNextAt = Date.now() + 1100;
      const url = `https://finnhub.io/api/v1/stock/metric?symbol=${encodeURIComponent(symbol)}&metric=all`;
      const resp = await fetch(url, { headers: { "X-Finnhub-Token": token }, cache: "no-store" });
      if (!resp.ok) return null;
      return resp.text();
    });
    if (!json) return { source: "finnhub", status: "failed", detail: "Finnhub metric request failed", observations: [] };
    const observations = parseFinnhubMetric(json, new Date().toISOString());
    if (observations.length === 0) return { source: "finnhub", status: "failed", detail: "Finnhub returned no mapped fields", observations: [] };
    return { source: "finnhub", status: "ok", observations };
  } catch (error) {
    return fail("finnhub", error);
  }
}

export async function pullFmp(db: Database.Database, ticker: string): Promise<SourceAttempt> {
  const key = envKey(FMP_ENV);
  if (!key) return { source: "fmp", status: "skipped", detail: `${FMP_ENV} is not set`, observations: [] };
  try {
    const symbol = ticker.trim().toUpperCase();
    const json = await cachedJson(db, `fmp:ratios-ttm:${symbol}`, 12 * 60 * 60 * 1000, async () => {
      const url = `https://financialmodelingprep.com/stable/ratios-ttm?symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) return null;
      return resp.text();
    });
    if (!json) return { source: "fmp", status: "failed", detail: "FMP ratios-ttm request failed", observations: [] };
    const observations = parseFmpRatios(json, new Date().toISOString());
    if (observations.length === 0) return { source: "fmp", status: "failed", detail: "FMP returned no mapped fields", observations: [] };
    return { source: "fmp", status: "ok", observations };
  } catch (error) {
    return fail("fmp", error);
  }
}

export async function pullAlphaVantage(db: Database.Database, ticker: string): Promise<SourceAttempt> {
  const key = envKey(ALPHA_VANTAGE_ENV);
  if (!key) return { source: "alphavantage", status: "skipped", detail: `${ALPHA_VANTAGE_ENV} is not set`, observations: [] };
  const day = new Date().toISOString().slice(0, 10);
  if (quotaCount(db, "alphavantage", day) >= ALPHA_DAILY_CAP) {
    return { source: "alphavantage", status: "skipped", detail: `Alpha Vantage free tier cap of ${ALPHA_DAILY_CAP} requests today`, observations: [] };
  }
  try {
    const symbol = ticker.trim().toUpperCase();
    const json = await cachedJson(db, `av:overview:${symbol}`, 20 * 60 * 60 * 1000, async () => {
      quotaAdd(db, "alphavantage", day);
      const url = `https://www.alphavantage.co/query?function=OVERVIEW&symbol=${encodeURIComponent(symbol)}&apikey=${encodeURIComponent(key)}`;
      const resp = await fetch(url, { cache: "no-store" });
      if (!resp.ok) return null;
      return resp.text();
    });
    if (!json) return { source: "alphavantage", status: "failed", detail: "OVERVIEW request failed", observations: [] };
    const record = json as Record<string, unknown>;
    if (typeof record.Note === "string" || typeof record.Information === "string") {
      return { source: "alphavantage", status: "failed", detail: String(record.Note ?? record.Information).slice(0, 300), observations: [] };
    }
    const observations = parseAlphaOverview(json, new Date().toISOString());
    if (observations.length === 0) return { source: "alphavantage", status: "failed", detail: "OVERVIEW had no mapped fields", observations: [] };
    return { source: "alphavantage", status: "ok", observations };
  } catch (error) {
    return fail("alphavantage", error);
  }
}

function padCik(cik: number): string {
  return String(Math.trunc(cik)).padStart(10, "0");
}

export async function pullSec(db: Database.Database, ticker: string, cik: number | null): Promise<SourceAttempt> {
  try {
    let resolved = cik;
    if (resolved == null) resolved = await lookupSecCompanyCik(ticker);
    if (resolved == null) return { source: "sec", status: "skipped", detail: "No CIK on file and SEC ticker map did not resolve one", observations: [] };
    const padded = padCik(resolved);
    const json = await cachedJson(db, `sec:companyfacts:${padded}`, 24 * 60 * 60 * 1000, async () => {
      return secFetchText(`https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`);
    });
    if (!json) return { source: "sec", status: "failed", detail: `companyfacts for CIK ${resolved} was empty`, observations: [] };
    const observations = parseSecCompanyFacts(json, new Date().toISOString()).map((obs) => ({
      ...obs,
      sourceUrl: `https://data.sec.gov/api/xbrl/companyfacts/CIK${padded}.json`,
      meta: { ...(obs.meta ?? {}), cik: resolved },
    }));
    if (observations.length === 0) {
      return { source: "sec", status: "failed", detail: `CIK ${resolved} had no trailing revenue or EPS that could be built from filed facts`, observations: [] };
    }
    return { source: "sec", status: "ok", observations };
  } catch (error) {
    return fail("sec", error);
  }
}

export function deriveCrossChecks(observations: ObservationInput[]): ObservationInput[] {
  const extra: ObservationInput[] = [];
  const eps = observations.find((obs) => obs.field === "eps_ttm" && obs.source === "sec" && (obs.valueNum ?? 0) > 0);
  const yahooPe = observations.find((obs) => obs.field === "pe_trailing" && obs.source === "yahoo_computed");
  const price = typeof yahooPe?.meta?.price === "number" ? yahooPe.meta.price : null;
  if (eps?.valueNum && price && price > 0) {
    extra.push({
      field: "pe_trailing",
      source: "sec_computed",
      valueNum: price / eps.valueNum,
      asOf: eps.asOf,
      meta: {
        formula: "Yahoo regularMarketPrice / SEC diluted EPS TTM",
        price,
        priceAsOf: yahooPe?.asOf ?? null,
        eps: eps.valueNum,
        epsAsOf: eps.asOf ?? null,
      },
    });
  }
  const revenue = observations.find((obs) => obs.field === "revenue_ttm" && obs.source === "sec" && (obs.valueNum ?? 0) > 0);
  const capOrder = ["schwab", "yahoo", "fmp", "alphavantage", "finnhub", "report:2026-11-12-close"];
  const cap = observations
    .filter((obs) => obs.field === "market_cap" && obs.valueNum != null && obs.valueNum > 0)
    .sort((a, b) => capOrder.indexOf(a.source) - capOrder.indexOf(b.source))[0];
  if (revenue?.valueNum && cap?.valueNum) {
    extra.push({
      field: "ps_trailing",
      source: "sec_computed",
      valueNum: cap.valueNum / revenue.valueNum,
      asOf: revenue.asOf,
      meta: {
        formula: "cited market cap / SEC revenue TTM",
        marketCap: cap.valueNum,
        marketCapSource: cap.source,
        marketCapAsOf: cap.asOf ?? null,
        revenue: revenue.valueNum,
        revenueAsOf: revenue.asOf ?? null,
      },
    });
  }
  return extra;
}
