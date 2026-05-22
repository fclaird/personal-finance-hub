import { getSecretsPassphrase } from "@/lib/env";
import { buildSymbolPayload } from "@/lib/x/digest";
import { writeSymbolCache } from "@/lib/x/cacheDb";
import { fetchRecentSearch, getValidXAccessToken } from "@/lib/x/client";
import type { XSymbolPayload } from "@/lib/x/types";

export type RefreshSymbolPostsResult =
  | { ok: true; payload: XSymbolPayload }
  | { ok: false; error: string; disconnected?: boolean };

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export async function refreshSymbolPosts(symbolRaw: string): Promise<RefreshSymbolPostsResult> {
  const symbol = normSym(symbolRaw);
  if (!symbol) {
    return { ok: false, error: "symbol required" };
  }

  try {
    const passphrase = getSecretsPassphrase();
    const valid = await getValidXAccessToken(passphrase);
    if (!valid) {
      return {
        ok: false,
        error: "Connect X on the Connections page to search cashtags.",
        disconnected: true,
      };
    }

    const start = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
    const q = `(${symbol} OR $${symbol}) -is:retweet lang:en`;
    const tweets = await fetchRecentSearch(valid.accessToken, q, start);
    const payload = await buildSymbolPayload(symbol, tweets);
    writeSymbolCache(payload);
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
