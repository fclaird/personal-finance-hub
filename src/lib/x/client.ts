import { X_API_BASE } from "@/lib/x/config";
import { getXToken, setXToken, type XToken } from "@/lib/x/token";
import { refreshXAccessToken } from "@/lib/x/oauth";

export type NormalizedTweet = {
  id: string;
  text: string;
  createdAt: string;
  authorId: string;
  username: string;
  url: string;
};

async function sleep(ms: number) {
  await new Promise((r) => setTimeout(r, ms));
}

export async function getValidXAccessToken(passphrase: string): Promise<{ accessToken: string; token: XToken } | null> {
  let t = getXToken(passphrase);
  if (!t?.access_token) return null;

  const expiresAt = t.obtained_at + Math.max(0, t.expires_in - 120) * 1000;
  if (Date.now() < expiresAt) {
    return { accessToken: t.access_token, token: t };
  }

  if (!t.refresh_token) return null;

  const next = await refreshXAccessToken(t.refresh_token);
  const merged: XToken = {
    ...t,
    ...next,
    refresh_token: next.refresh_token ?? t.refresh_token,
    obtained_at: Date.now(),
  };
  setXToken(passphrase, merged);
  t = merged;
  return { accessToken: t.access_token, token: t };
}

async function xFetch<T>(accessToken: string, pathAndQuery: string): Promise<{ ok: true; data: T } | { ok: false; status: number; body: string }> {
  const resp = await fetch(`${X_API_BASE}${pathAndQuery}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  const text = await resp.text().catch(() => "");
  if (resp.status === 429) {
    await sleep(2000);
  }
  if (!resp.ok) return { ok: false, status: resp.status, body: text };
  try {
    return { ok: true, data: JSON.parse(text) as T };
  } catch {
    return { ok: false, status: resp.status, body: text || "invalid json" };
  }
}

type UsersMe = { data?: { id: string; name?: string; username?: string } };

export async function fetchXUserId(accessToken: string): Promise<string | null> {
  const r = await xFetch<UsersMe>(accessToken, "/users/me");
  if (!r.ok) return null;
  return r.data.data?.id ?? null;
}

type TimelineResp = {
  data?: Array<{ id: string; text: string; created_at: string; author_id: string }>;
  includes?: { users?: Array<{ id: string; username: string }> };
  meta?: { next_token?: string; result_count?: number };
};

function userMapFromIncludes(includes: TimelineResp["includes"]): Map<string, string> {
  const m = new Map<string, string>();
  for (const u of includes?.users ?? []) m.set(u.id, u.username ?? "user");
  return m;
}

function normalizeTweet(
  t: NonNullable<TimelineResp["data"]>[number],
  users: Map<string, string>,
): NormalizedTweet {
  const username = users.get(t.author_id) ?? "i";
  return {
    id: t.id,
    text: t.text,
    createdAt: t.created_at,
    authorId: t.author_id,
    username,
    url: `https://x.com/${username}/status/${t.id}`,
  };
}

/** Reverse-chronological user timeline (requires X API tier that exposes this endpoint). */
export async function fetchUserTimeline24h(accessToken: string, userId: string): Promise<NormalizedTweet[]> {
  const cutoff = Date.now() - 24 * 60 * 60_000;
  const out: NormalizedTweet[] = [];
  let token: string | undefined;

  for (let page = 0; page < 8; page += 1) {
    const q = new URLSearchParams();
    q.set("max_results", "100");
    q.set("tweet.fields", "created_at,author_id");
    q.set("expansions", "author_id");
    q.set("user.fields", "username");
    if (token) q.set("pagination_token", token);

    const path = `/users/${encodeURIComponent(userId)}/timelines/reverse_chronological?${q.toString()}`;
    const r = await xFetch<TimelineResp>(accessToken, path);
    if (!r.ok) {
      break;
    }

    const chunk = r.data.data ?? [];
    if (chunk.length === 0) break;

    const users = userMapFromIncludes(r.data.includes);
    let oldestInPage = Date.now();
    for (const tw of chunk) {
      const ms = Date.parse(tw.created_at);
      if (Number.isFinite(ms)) oldestInPage = Math.min(oldestInPage, ms);
      if (Number.isFinite(ms) && ms >= cutoff) {
        out.push(normalizeTweet(tw, users));
      }
    }

    token = r.data.meta?.next_token;
    if (!token) break;
    if (oldestInPage < cutoff) break;
  }

  const seen = new Set<string>();
  return out.filter((t) => (seen.has(t.id) ? false : (seen.add(t.id), true)));
}

type SearchResp = {
  data?: Array<{ id: string; text: string; created_at: string; author_id: string }>;
  includes?: { users?: Array<{ id: string; username: string }> };
  meta?: { next_token?: string };
};

export async function fetchRecentSearch(
  accessToken: string,
  query: string,
  startTimeIso: string,
): Promise<NormalizedTweet[]> {
  const q = new URLSearchParams();
  q.set("query", query);
  q.set("start_time", startTimeIso);
  q.set("max_results", "100");
  q.set("tweet.fields", "created_at,author_id");
  q.set("expansions", "author_id");
  q.set("user.fields", "username");

  const r = await xFetch<SearchResp>(accessToken, `/tweets/search/recent?${q.toString()}`);
  if (!r.ok) return [];

  const users = userMapFromIncludes(r.data.includes);
  const chunk = r.data.data ?? [];
  return chunk.map((tw) => normalizeTweet(tw, users));
}
