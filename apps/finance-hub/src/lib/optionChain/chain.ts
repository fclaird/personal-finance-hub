/**
 * Normalized option chain. No Schwab or Cboe fields.
 * Listed expiries and strikes are whatever the feed returned.
 */

declare const isoDateBrand: unique symbol;

/** YYYY-MM-DD New York calendar date. Build it with isoDate(). */
export type IsoDate = string & { readonly [isoDateBrand]: true };

const ISO_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isoDate(s: string): IsoDate {
  const m = ISO_RE.exec(s.trim());
  if (!m) throw new Error(`Not a calendar date: ${s}`);
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  const dt = new Date(Date.UTC(year, month - 1, day));
  if (dt.getUTCFullYear() !== year || dt.getUTCMonth() !== month - 1 || dt.getUTCDate() !== day) {
    throw new Error(`Not a calendar date: ${s}`);
  }
  return s as IsoDate;
}

export function calendarDaysBetween(from: IsoDate, to: IsoDate): number {
  const a = Date.parse(`${from}T12:00:00Z`);
  const b = Date.parse(`${to}T12:00:00Z`);
  return Math.round((b - a) / 86_400_000);
}

export function addCalendarDays(d: IsoDate, days: number): IsoDate {
  const dt = new Date(Date.parse(`${d}T12:00:00Z`) + days * 86_400_000);
  const y = dt.getUTCFullYear();
  const m = String(dt.getUTCMonth() + 1).padStart(2, "0");
  const day = String(dt.getUTCDate()).padStart(2, "0");
  return isoDate(`${y}-${m}-${day}`);
}

export function addCalendarMonths(d: IsoDate, months: number): IsoDate {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const target = new Date(Date.UTC(y, m - 1 + months, 1));
  const last = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  const clamped = Math.min(day, last);
  const mm = String(target.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(clamped).padStart(2, "0");
  return isoDate(`${target.getUTCFullYear()}-${mm}-${dd}`);
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Thu Jun 17, 2027". Weekday comes from the listed date, including holiday Thursdays. */
export function formatExpiryLabel(d: IsoDate): string {
  const [y, m, day] = d.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, day));
  return `${WEEKDAYS[dt.getUTCDay()]} ${MONTHS[m - 1]} ${day}, ${y}`;
}

export type OptionRight = "C" | "P";
export type ChainSource = "schwab" | "cboe";

export type ContractQuote = {
  readonly bid: number | null;
  readonly ask: number | null;
  readonly mid: number | null;
  /** Feed IV as a decimal, when the feed printed one. The lab solves its own by default. */
  readonly feedIv: number | null;
};

export type StrikeRow = {
  readonly strike: number;
  readonly call: ContractQuote | null;
  readonly put: ContractQuote | null;
};

export type ChainExpiry = {
  readonly date: IsoDate;
  readonly strikes: readonly StrikeRow[];
};

export type ChainProvenance = {
  readonly source: ChainSource;
  readonly delayed: boolean;
  readonly quoteTime: string | null;
  readonly fetchedAt: string;
  readonly servedFrom: "network" | "cache" | "staleCache";
  readonly fallbackFrom: string | null;
  readonly excluded: number;
};

export type OptionChain = {
  readonly symbol: string;
  readonly tradeDate: IsoDate;
  readonly spot: number;
  readonly dividendYieldHint: number | null;
  readonly multiplier: 100;
  readonly expiries: readonly ChainExpiry[];
  readonly provenance: ChainProvenance;
};

export type DraftContract = {
  readonly expiry: string;
  readonly right: OptionRight;
  readonly strike: number;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly feedIv: number | null;
  /** Null when the feed does not say. Anything other than 100 is dropped. */
  readonly multiplier: number | null;
  /** OSI root. Dropped when it differs from the underlying. */
  readonly root: string | null;
};

export type ChainDraft = {
  readonly symbol: string;
  readonly spot: number;
  readonly tradeDate: string;
  readonly quoteTime: string | null;
  readonly source: ChainSource;
  readonly delayed: boolean;
  readonly dividendYieldHint: number | null;
  readonly contracts: readonly DraftContract[];
  readonly fetchedAt: string;
  readonly servedFrom: ChainProvenance["servedFrom"];
  readonly fallbackFrom: string | null;
};

export type MakeChainResult = { readonly ok: true; readonly chain: OptionChain } | { readonly ok: false; readonly error: string };

function finiteOrNull(n: number | null): number | null {
  return n != null && Number.isFinite(n) ? n : null;
}

function quoteOf(bid: number | null, ask: number | null, feedIv: number | null): ContractQuote | null {
  const b = finiteOrNull(bid);
  const a = finiteOrNull(ask);
  const bidOk = b != null && b >= 0 ? b : null;
  const askOk = a != null && a >= 0 ? a : null;
  if (bidOk == null && askOk == null) return null;
  const mid = bidOk != null && askOk != null ? (bidOk + askOk) / 2 : null;
  const iv = feedIv != null && Number.isFinite(feedIv) && feedIv > 0 ? feedIv : null;
  return { bid: bidOk, ask: askOk, mid, feedIv: iv };
}

function tighter(a: ContractQuote, b: ContractQuote): ContractQuote {
  const width = (q: ContractQuote) => (q.bid != null && q.ask != null ? q.ask - q.bid : Number.POSITIVE_INFINITY);
  return width(a) <= width(b) ? a : b;
}

/** Sort, drop non-standard deliverables, and build the domain chain. */
export function makeOptionChain(draft: ChainDraft): MakeChainResult {
  const symbol = draft.symbol.trim().toUpperCase();
  if (!/^[A-Z][A-Z0-9.]{0,9}$/.test(symbol)) return { ok: false, error: "Bad symbol." };
  if (!(draft.spot > 0) || !Number.isFinite(draft.spot)) return { ok: false, error: "Bad spot." };
  let tradeDate: IsoDate;
  try {
    tradeDate = isoDate(draft.tradeDate);
  } catch {
    return { ok: false, error: "Bad trade date." };
  }

  let excluded = 0;
  const byExpiry = new Map<string, Map<number, { call: ContractQuote | null; put: ContractQuote | null }>>();

  for (const c of draft.contracts) {
    if (c.multiplier != null && c.multiplier !== 100) {
      excluded += 1;
      continue;
    }
    if (c.root && c.root.toUpperCase() !== symbol) {
      excluded += 1;
      continue;
    }
    if (!(c.strike > 0) || !Number.isFinite(c.strike)) {
      excluded += 1;
      continue;
    }
    let expiry: IsoDate;
    try {
      expiry = isoDate(c.expiry);
    } catch {
      excluded += 1;
      continue;
    }
    const q = quoteOf(c.bid, c.ask, c.feedIv);
    if (!q) {
      excluded += 1;
      continue;
    }
    const key = Math.round(c.strike * 1000);
    let strikes = byExpiry.get(expiry);
    if (!strikes) {
      strikes = new Map();
      byExpiry.set(expiry, strikes);
    }
    let row = strikes.get(key);
    if (!row) {
      row = { call: null, put: null };
      strikes.set(key, row);
    }
    if (c.right === "C") row.call = row.call ? tighter(row.call, q) : q;
    else row.put = row.put ? tighter(row.put, q) : q;
  }

  const expiries: ChainExpiry[] = [...byExpiry.entries()]
    .sort((a, b) => (a[0] < b[0] ? -1 : 1))
    .map(([date, strikes]) => ({
      date: date as IsoDate,
      strikes: [...strikes.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([key, row]) => ({ strike: key / 1000, call: row.call, put: row.put })),
    }));

  if (expiries.length === 0) return { ok: false, error: "No listed contracts." };

  return {
    ok: true,
    chain: {
      symbol,
      tradeDate,
      spot: draft.spot,
      dividendYieldHint: draft.dividendYieldHint,
      multiplier: 100,
      expiries,
      provenance: {
        source: draft.source,
        delayed: draft.delayed,
        quoteTime: draft.quoteTime,
        fetchedAt: draft.fetchedAt,
        servedFrom: draft.servedFrom,
        fallbackFrom: draft.fallbackFrom,
        excluded,
      },
    },
  };
}

export function findQuote(chain: OptionChain, expiry: IsoDate, right: OptionRight, strike: number): ContractQuote | null {
  const exp = chain.expiries.find((e) => e.date === expiry);
  if (!exp) return null;
  const key = Math.round(strike * 1000);
  const row = exp.strikes.find((s) => Math.round(s.strike * 1000) === key);
  if (!row) return null;
  return right === "C" ? row.call : row.put;
}

export function listedStrikes(chain: OptionChain, expiry: IsoDate, right: OptionRight): number[] {
  const exp = chain.expiries.find((e) => e.date === expiry);
  if (!exp) return [];
  return exp.strikes.filter((s) => (right === "C" ? s.call : s.put) != null).map((s) => s.strike);
}

/** Nearest listed expiry. Holiday Fridays that are not listed land on the feed's date. */
export function nearestExpiry(chain: OptionChain, requested: IsoDate): IsoDate | null {
  if (chain.expiries.length === 0) return null;
  let best = chain.expiries[0]!.date;
  let bestAbs = Math.abs(calendarDaysBetween(requested, best));
  for (const e of chain.expiries) {
    const d = Math.abs(calendarDaysBetween(requested, e.date));
    if (d < bestAbs) {
      best = e.date;
      bestAbs = d;
    }
  }
  return best;
}

export function nearestStrike(strikes: readonly number[], strike: number): number | null {
  if (strikes.length === 0) return null;
  let best = strikes[0]!;
  let bestAbs = Math.abs(best - strike);
  for (const s of strikes) {
    const d = Math.abs(s - strike);
    if (d < bestAbs) {
      best = s;
      bestAbs = d;
    }
  }
  return best;
}

/** 60s while the US cash session is open, 15 minutes otherwise. Refresh skips the cache. */
export function cacheIsFresh(fetchedAtMs: number, nowMs: number, sessionOpen: boolean, refresh: boolean): boolean {
  if (refresh) return false;
  if (!Number.isFinite(fetchedAtMs)) return false;
  const age = nowMs - fetchedAtMs;
  const ttl = sessionOpen ? 60_000 : 15 * 60_000;
  return age >= 0 && age < ttl;
}
