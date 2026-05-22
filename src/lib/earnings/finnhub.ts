export type FinnhubEarningsCalendarItem = {
  date?: string;
  symbol?: string;
  eps?: number | null;
  epsEstimated?: number | null;
  revenue?: number | null;
  revenueEstimated?: number | null;
  time?: string;
  fiscalDateEnding?: string;
};

type FinnhubCalendarResponse = {
  earningsCalendar?: FinnhubEarningsCalendarItem[];
};

type FinnhubCandleResponse = {
  s?: string;
  t?: number[];
  c?: number[];
  v?: number[];
};

function getFinnhubToken(): string | null {
  const t = process.env.FINNHUB_API_KEY?.trim();
  return t || null;
}

export function isFinnhubConfigured(): boolean {
  return getFinnhubToken() != null;
}

/** Earnings in [from, to] inclusive. If `symbol` omitted, Finnhub returns a broad calendar when supported. */
export async function fetchFinnhubEarningsCalendar(
  fromIso: string,
  toIso: string,
  symbol?: string,
): Promise<FinnhubEarningsCalendarItem[]> {
  const token = getFinnhubToken();
  if (!token) throw new Error("FINNHUB_API_KEY is not set.");

  const u = new URL("https://finnhub.io/api/v1/calendar/earnings");
  u.searchParams.set("from", fromIso);
  u.searchParams.set("to", toIso);
  u.searchParams.set("token", token);
  if (symbol) u.searchParams.set("symbol", symbol);

  const resp = await fetch(u.toString(), { cache: "no-store" });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Finnhub calendar error ${resp.status}: ${text.slice(0, 200)}`);
  }
  const json = (await resp.json()) as FinnhubCalendarResponse;
  return json.earningsCalendar ?? [];
}

const emptyLiquidity = { avgDollarVolume20d: null as number | null };

/** Daily candles: 20-day average dollar volume (close × volume) — liquidity vs typical names, not short-term spikes. */
export async function fetchFinnhubLiquidityFromCandles(symbol: string): Promise<{ avgDollarVolume20d: number | null }> {
  const token = getFinnhubToken();
  if (!token) throw new Error("FINNHUB_API_KEY is not set.");

  const to = Math.floor(Date.now() / 1000);
  const from = to - 120 * 24 * 3600;

  const u = new URL("https://finnhub.io/api/v1/stock/candle");
  u.searchParams.set("symbol", symbol.toUpperCase());
  u.searchParams.set("resolution", "D");
  u.searchParams.set("from", String(from));
  u.searchParams.set("to", String(to));
  u.searchParams.set("token", token);

  const resp = await fetch(u.toString(), { cache: "no-store" });
  if (!resp.ok) return emptyLiquidity;

  const json = (await resp.json()) as FinnhubCandleResponse;
  if (json.s === "no_data" || !json.v?.length || !json.c?.length) return emptyLiquidity;

  const n = Math.min(json.c.length, json.v.length);
  if (n < 15) return emptyLiquidity;

  const c = json.c;
  const v = json.v;
  const start = n - 20;
  let sum = 0;
  let count = 0;
  for (let i = Math.max(0, start); i < n; i++) {
    const close = c[i];
    const vol = v[i];
    if (typeof close !== "number" || typeof vol !== "number" || !Number.isFinite(close) || !Number.isFinite(vol)) continue;
    if (close <= 0 || vol < 0) continue;
    sum += close * vol;
    count++;
  }

  if (count < 10) return emptyLiquidity;

  return { avgDollarVolume20d: sum / count };
}
