/**
 * Public Yahoo chart endpoint (events=div) — used when Schwab fundamentals omit yield.
 * Not an official API; best-effort for modeling. See raw payload in snapshots for audit.
 */

const YAHOO_UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

function yahooChartSymbol(symbol: string): string {
  return symbol.trim().toUpperCase().replace(/\./g, "-");
}

function isoFromUnix(sec: number): string {
  return new Date(sec * 1000).toISOString().slice(0, 10);
}

export type YahooDividendPayment = { payDateIso: string; amount: number };

function parseDividendRows(result: Record<string, unknown>): { t: number; amount: number }[] {
  const source = (result.events as Record<string, unknown> | undefined)?.dividends as
    | Record<string, { amount?: number; date?: number }>
    | undefined;
  if (!source || typeof source !== "object") return [];

  const rows: { t: number; amount: number }[] = [];
  for (const v of Object.values(source)) {
    if (!v || typeof v !== "object") continue;
    const amount = typeof v.amount === "number" && Number.isFinite(v.amount) ? v.amount : null;
    const date = typeof v.date === "number" && Number.isFinite(v.date) ? v.date : null;
    if (amount == null || date == null || amount <= 0) continue;
    rows.push({ t: date, amount });
  }
  rows.sort((a, b) => a.t - b.t);
  return rows;
}

export async function fetchYahooDividendPayments(symbol: string): Promise<YahooDividendPayment[]> {
  const sym = yahooChartSymbol(symbol);
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y&events=div`;
  const resp = await fetch(url, {
    headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
  });
  if (!resp.ok) return [];
  const json = (await resp.json()) as Record<string, unknown>;
  const chart = json.chart as Record<string, unknown> | undefined;
  const result = Array.isArray(chart?.result) ? (chart!.result as Record<string, unknown>[])[0] : null;
  if (!result) return [];
  return parseDividendRows(result).map((r) => ({ payDateIso: isoFromUnix(r.t), amount: r.amount }));
}

export type YahooTrailingDividendStats = {
  annualTrailing12m: number | null;
  /** annualTrailing12m / Yahoo last price (decimal, e.g. 0.034) */
  divYield: number | null;
  /** Projected next ex-date (YYYY-MM-DD) from median spacing; informational. */
  nextExDateIso: string | null;
  chartPrice: number | null;
  /** Chart meta longName / shortName when present */
  longName: string | null;
  raw: Record<string, unknown>;
};

function median(nums: number[]): number | null {
  if (nums.length === 0) return null;
  const s = [...nums].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

export async function fetchYahooTrailingDividendStats(symbol: string): Promise<YahooTrailingDividendStats | null> {
  const sym = yahooChartSymbol(symbol);
  const url = `https://query2.finance.yahoo.com/v8/finance/chart/${encodeURIComponent(sym)}?interval=1d&range=5y&events=div`;
  const resp = await fetch(url, {
    headers: { "User-Agent": YAHOO_UA, Accept: "application/json" },
  });
  if (!resp.ok) return null;
  const json = (await resp.json()) as Record<string, unknown>;
  const chart = json.chart as Record<string, unknown> | undefined;
  const result = Array.isArray(chart?.result) ? (chart!.result as Record<string, unknown>[])[0] : null;
  if (!result) return null;

  const meta = result.meta as Record<string, unknown> | undefined;
  const chartPrice =
    typeof meta?.regularMarketPrice === "number" && Number.isFinite(meta.regularMarketPrice)
      ? meta.regularMarketPrice
      : null;
  const longName =
    typeof meta?.longName === "string" && meta.longName.trim()
      ? meta.longName.trim()
      : typeof meta?.shortName === "string" && meta.shortName.trim()
        ? meta.shortName.trim()
        : null;

  const rows = parseDividendRows(result);
  if (rows.length === 0) {
    return {
      annualTrailing12m: null,
      divYield: null,
      nextExDateIso: null,
      chartPrice,
      longName,
      raw: { meta: { symbol: sym, longName }, note: "no_dividend_events" },
    };
  }

  const now = Math.floor(Date.now() / 1000);
  const yearSec = Math.floor(365.25 * 86400);
  const windowStart = now - yearSec;
  let t12 = 0;
  for (const r of rows) {
    if (r.t >= windowStart) t12 += r.amount;
  }

  if (t12 <= 0 && rows.length >= 4) {
    t12 = rows.slice(-4).reduce((s, r) => s + r.amount, 0);
  }
  if (t12 <= 0 && rows.length >= 1) {
    const tail = rows.slice(-Math.min(6, rows.length));
    const avg = tail.reduce((s, r) => s + r.amount, 0) / tail.length;
    t12 = avg * 12;
  }

  const annualTrailing12m = t12 > 0 && Number.isFinite(t12) ? t12 : null;
  const px = chartPrice != null && chartPrice > 0 ? chartPrice : null;
  const divYield = annualTrailing12m != null && px != null ? annualTrailing12m / px : null;

  const gaps: number[] = [];
  for (let i = 1; i < rows.length; i++) gaps.push(rows[i]!.t - rows[i - 1]!.t);
  const med = median(gaps) ?? 90 * 86400;
  const lastPay = rows[rows.length - 1]!.t;
  let nextT = lastPay + med;
  let guard = 0;
  while (nextT < now - 43200 && guard < 200) {
    nextT += med;
    guard++;
  }
  const nextExDateIso = isoFromUnix(nextT);

  return {
    annualTrailing12m,
    divYield,
    nextExDateIso,
    chartPrice,
    longName,
    raw: {
      symbol: sym,
      longName,
      paymentsParsed: rows.length,
      trailing12mSum: annualTrailing12m,
      medianGapDays: med / 86400,
      lastDividendIso: isoFromUnix(lastPay),
    },
  };
}
