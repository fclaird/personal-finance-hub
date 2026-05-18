import { getSecretsPassphrase } from "@/lib/env";
import { marketDataQueueForPath, withMarketDataRateLimit } from "@/lib/schwab/marketDataRateLimit";
import { SCHWAB_MARKETDATA_API_BASE, SCHWAB_TRADER_API_BASE } from "@/lib/schwab/config";
import { isSchwabRefreshTokenRejectedMessage, refreshToken } from "@/lib/schwab/oauth";
import { clearSchwabToken, getSchwabToken, setSchwabToken, type SchwabToken } from "@/lib/schwab/token";

const REFRESH_SKEW_MS = 60_000;

function isExpired(token: SchwabToken) {
  const expiresAt = token.obtained_at + token.expires_in * 1000;
  return Date.now() >= expiresAt - REFRESH_SKEW_MS;
}

function joinBaseAndPath(base: string, path: string): URL {
  const u = new URL(base);
  const basePath = u.pathname.replace(/\/+$/, "");
  const rel = path.replace(/^\/+/, "");
  const qIdx = rel.indexOf("?");
  const p = qIdx >= 0 ? rel.slice(0, qIdx) : rel;
  const q = qIdx >= 0 ? rel.slice(qIdx) : "";
  u.pathname = `${basePath}/${p}`;
  u.search = q;
  return u;
}

async function getValidToken(): Promise<SchwabToken> {
  const passphrase = getSecretsPassphrase();
  const token = getSchwabToken(passphrase);
  if (!token) throw new Error("Schwab is not connected yet.");

  if (!isExpired(token)) return token;
  try {
    const refreshed = await refreshToken(token.refresh_token);
    const next: SchwabToken = { ...refreshed, obtained_at: Date.now() };
    setSchwabToken(passphrase, next);
    return next;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    if (isSchwabRefreshTokenRejectedMessage(msg)) {
      clearSchwabToken(passphrase);
      throw new Error(
        `${msg}\n\nSchwab disconnected locally because the refresh token is no longer valid. Open Connections and sign in to Schwab again (check SCHWAB_REDIRECT_URI matches your developer app).`,
      );
    }
    throw e;
  }
}

/** Calendar YYYY-MM-DD in America/New_York for an instant (fallback when HTTP Date is missing). */
function nyIsoFromInstant(ms: number): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date(ms));
  const y = parts.find((p) => p.type === "year")?.value;
  const m = parts.find((p) => p.type === "month")?.value;
  const d = parts.find((p) => p.type === "day")?.value;
  if (!y || !m || !d) return new Date(ms).toISOString().slice(0, 10);
  return `${y}-${m}-${d}`;
}

function nyIsoFromHttpDateHeader(header: string | null): string | null {
  if (!header) return null;
  const ms = Date.parse(header);
  if (Number.isNaN(ms)) return null;
  return nyIsoFromInstant(ms);
}

/**
 * Schwab validates transaction windows against broker time, not the client clock.
 * Use the Trader API response `Date` header (converted to NY calendar) so skewed laptops don't send "future" dates.
 */
export async function getSchwabTraderCalendarCapIso(): Promise<string> {
  const token = await getValidToken();
  const url = joinBaseAndPath(SCHWAB_TRADER_API_BASE, "accounts/accountNumbers");
  const resp = await fetch(url, {
    headers: {
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
    },
  });
  const fromHeader = nyIsoFromHttpDateHeader(resp.headers.get("date"));
  if (fromHeader) return fromHeader;
  return nyIsoFromInstant(Date.now());
}

export async function schwabFetch<T>(
  path: string,
  init?: RequestInit,
): Promise<T> {
  const token = await getValidToken();
  const url = joinBaseAndPath(SCHWAB_TRADER_API_BASE, path);
  const resp = await fetch(url, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      Authorization: `Bearer ${token.access_token}`,
      Accept: "application/json",
    },
  });
  if (!resp.ok) {
    const text = await resp.text().catch(() => "");
    throw new Error(`Schwab API error (${url.toString()}): ${resp.status} ${resp.statusText} ${text}`);
  }
  return (await resp.json()) as T;
}

export async function schwabMarketFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const queue = marketDataQueueForPath(path);
  return withMarketDataRateLimit(queue, async () => {
    const token = await getValidToken();
    const url = joinBaseAndPath(SCHWAB_MARKETDATA_API_BASE, path);
    const resp = await fetch(url, {
      ...init,
      headers: {
        ...(init?.headers ?? {}),
        Authorization: `Bearer ${token.access_token}`,
        Accept: "application/json",
      },
    });
    if (!resp.ok) {
      const text = await resp.text().catch(() => "");
      throw new Error(`Schwab Market Data API error (${url.toString()}): ${resp.status} ${resp.statusText} ${text}`);
    }
    return (await resp.json()) as T;
  });
}

