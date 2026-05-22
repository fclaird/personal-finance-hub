import type { NormalizedTweet } from "@/lib/x/client";
import type { XDigestIdea, XDigestPayload, XDigestSection, XDigestSectionId, XSymbolPayload } from "@/lib/x/types";

export type { XDigestIdea, XDigestPayload, XDigestSection, XDigestSectionId, XSymbolPayload };

function postsRecord(tweets: NormalizedTweet[]): XDigestPayload["posts"] {
  const posts: XDigestPayload["posts"] = {};
  for (const t of tweets) {
    posts[t.id] = { url: t.url, text: t.text, author: t.username, createdAt: t.createdAt };
  }
  return posts;
}

const FINANCE_KW = /\b(stock|stocks|market|nasdaq|nyse|spx|spy|qqq|fed|rates|yield|treasury|earnings|revenue|ipo|sec|bank|oil|gold|bitcoin|btc|crypto|trader|investor)\b/i;
const POLITICS_KW = /\b(congress|senate|house|biden|trump|election|gop|democrat|republican|white house|scotus|vote|campaign)\b/i;
const WORLD_KW = /\b(nato|un\b|china|russia|ukraine|israel|gaza|iran|eu\b|brexit|war|ceasefire|summit|embassy)\b/i;

function bucketFor(text: string): XDigestSectionId {
  if (POLITICS_KW.test(text)) return "politics";
  if (WORLD_KW.test(text)) return "world";
  if (FINANCE_KW.test(text)) return "finance";
  return "world";
}

export function rulesOnlyDigest(tweets: NormalizedTweet[], generatedAt: string): XDigestPayload {
  const buckets: Record<XDigestSectionId, NormalizedTweet[]> = {
    finance: [],
    world: [],
    politics: [],
  };

  for (const t of tweets) {
    buckets[bucketFor(t.text)].push(t);
  }

  const headings: Record<XDigestSectionId, string> = {
    finance: "Finance & markets",
    world: "World & macro",
    politics: "Politics & policy",
  };

  const sections: XDigestSection[] = (["finance", "world", "politics"] as const).map((id) => {
    const picks = buckets[id].slice(0, 4);
    const ideas: XDigestIdea[] = picks.map((tw) => ({
      text: tw.text.length > 200 ? `${tw.text.slice(0, 197)}…` : tw.text,
      postIds: [tw.id],
    }));
    return { id, heading: headings[id], ideas };
  });

  return { sections, posts: postsRecord(tweets), generatedAt };
}

type LlmSection = { id: string; heading: string; ideas: Array<{ text: string; postIds: string[] }> };

export async function llmDigest(tweets: NormalizedTweet[], generatedAt: string): Promise<XDigestPayload | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key) return null;

  const lines = tweets.slice(0, 80).map((t) => `${t.id}\t@${t.username}\t${t.text.replace(/\s+/g, " ").trim()}`);
  const prompt = `You are a news assistant. Group the following posts from the user's X timeline into three sections: finance (markets, companies, econ), world (international, geopolitics, science crossovers), politics (US/UK/EU government and elections). Output strict JSON with shape:
{"sections":[{"id":"finance"|"world"|"politics","heading":string,"ideas":[{"text":string,"postIds":string[]}]}]}
Rules: 2-4 ideas per section; each idea is a short summary (max 220 chars); postIds must be from the input ids only; omit empty sections; do not invent ids.

Posts (id, user, text):
${lines.join("\n")}`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return only valid JSON." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!resp.ok) return null;
  const raw = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = raw.choices?.[0]?.message?.content;
  if (!content) return null;

  let parsed: { sections?: LlmSection[] };
  try {
    parsed = JSON.parse(content) as { sections?: LlmSection[] };
  } catch {
    return null;
  }

  const allowed = new Set(tweets.map((t) => t.id));
  const sections: XDigestSection[] = [];
  for (const s of parsed.sections ?? []) {
    const id = s.id as XDigestSectionId;
    if (id !== "finance" && id !== "world" && id !== "politics") continue;
    const ideas = (s.ideas ?? [])
      .map((idea) => ({
        text: String(idea.text ?? "").slice(0, 400),
        postIds: (idea.postIds ?? []).filter((pid) => allowed.has(pid)).slice(0, 6),
      }))
      .filter((i) => i.text.length > 0 && i.postIds.length > 0)
      .slice(0, 4);
    if (!ideas.length) continue;
    sections.push({
      id,
      heading: String(s.heading || "").slice(0, 120) || id,
      ideas,
    });
  }

  if (!sections.length) return null;
  return { sections, posts: postsRecord(tweets), generatedAt };
}

export async function buildDigestFromTweets(tweets: NormalizedTweet[]): Promise<XDigestPayload> {
  const generatedAt = new Date().toISOString();
  const llm = await llmDigest(tweets, generatedAt);
  if (llm) return llm;
  return rulesOnlyDigest(tweets, generatedAt);
}

export function rulesSymbolSummary(sym: string, tweets: NormalizedTweet[], generatedAt: string): XSymbolPayload {
  const top = tweets.slice(0, 8);
  const summary =
    top.length === 0
      ? `No recent posts found for ${sym} in the search window.`
      : top
          .slice(0, 3)
          .map((t) => `@${t.username}: ${t.text.length > 140 ? `${t.text.slice(0, 137)}…` : t.text}`)
          .join(" \u2022 ");

  return {
    symbol: sym,
    summary,
    posts: top.map((t) => ({
      id: t.id,
      url: t.url,
      text: t.text,
      author: t.username,
      createdAt: t.createdAt,
    })),
    generatedAt,
  };
}

export async function llmSymbolSummary(sym: string, tweets: NormalizedTweet[], generatedAt: string): Promise<XSymbolPayload | null> {
  const key = process.env.OPENAI_API_KEY?.trim();
  if (!key || tweets.length === 0) return null;

  const lines = tweets.slice(0, 40).map((t) => `${t.id}\t@${t.username}\t${t.text.replace(/\s+/g, " ").trim()}`);
  const prompt = `Summarize X discussion about ${sym} (ticker/company). Output JSON: {"summary": string (max 400 chars, 2-3 sentences), "highlightIds": string[] (up to 5 tweet ids that best support the summary)}
Posts:
${lines.join("\n")}`;

  const resp = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL?.trim() || "gpt-4o-mini",
      temperature: 0.3,
      response_format: { type: "json_object" },
      messages: [
        { role: "system", content: "Return only valid JSON." },
        { role: "user", content: prompt },
      ],
    }),
  });

  if (!resp.ok) return null;
  const raw = (await resp.json()) as { choices?: Array<{ message?: { content?: string } }> };
  const content = raw.choices?.[0]?.message?.content;
  if (!content) return null;

  let parsed: { summary?: string; highlightIds?: string[] };
  try {
    parsed = JSON.parse(content) as { summary?: string; highlightIds?: string[] };
  } catch {
    return null;
  }

  const allowed = new Set(tweets.map((t) => t.id));
  const ids = (parsed.highlightIds ?? []).filter((id) => allowed.has(id)).slice(0, 5);
  const byId = new Map(tweets.map((t) => [t.id, t] as const));
  const ordered = ids.length ? ids.map((id) => byId.get(id)!).filter(Boolean) : tweets.slice(0, 8);

  return {
    symbol: sym,
    summary: String(parsed.summary ?? "").slice(0, 500) || rulesSymbolSummary(sym, tweets, generatedAt).summary,
    posts: ordered.map((t) => ({
      id: t.id,
      url: t.url,
      text: t.text,
      author: t.username,
      createdAt: t.createdAt,
    })),
    generatedAt,
  };
}

export async function buildSymbolPayload(sym: string, tweets: NormalizedTweet[]): Promise<XSymbolPayload> {
  const generatedAt = new Date().toISOString();
  const llm = await llmSymbolSummary(sym, tweets, generatedAt);
  if (llm) return llm;
  return rulesSymbolSummary(sym, tweets, generatedAt);
}
