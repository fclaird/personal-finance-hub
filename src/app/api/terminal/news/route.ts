import { NextResponse } from "next/server";

export type NewsItem = {
  title: string;
  link: string;
  pubDate: string;
  symbols: string[];
  category: string;
  source: string;
};

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

const TTL_MS = 5 * 60_000;
const cache = new Map<string, { expiresAt: number; items: NewsItem[] }>();

const FETCH_TIMEOUT_MS = 12_000;
const MAX_PER_FEED = 10;
const MAX_YAHOO_PER_SYMBOL = 12;
const MAX_RESPONSE_ITEMS = 42;

type StaticFeed = { id: string; label: string; url: string; categoryDefault: string };

const DEFAULT_MACRO_FEEDS: StaticFeed[] = [
  { id: "bbc-business", label: "BBC", url: "https://feeds.bbci.co.uk/news/business/rss.xml", categoryDefault: "macro" },
  { id: "npr-business", label: "NPR", url: "https://feeds.npr.org/1017/rss.xml", categoryDefault: "macro" },
  { id: "guardian-business", label: "Guardian", url: "https://www.theguardian.com/uk/business/rss", categoryDefault: "macro" },
  { id: "cnbc-top", label: "CNBC", url: "https://www.cnbc.com/id/100003114/device/rss/rss.html", categoryDefault: "macro" },
];

function extraFeedsFromEnv(): StaticFeed[] {
  const raw = process.env.NEWS_RSS_FEEDS?.trim();
  if (!raw) return [];
  const out: StaticFeed[] = [];
  let i = 0;
  for (const part of raw.split(",")) {
    const url = part.trim();
    if (!url.startsWith("http")) continue;
    let host = "RSS";
    try {
      host = new URL(url).hostname.replace(/^www\./, "").split(".")[0] ?? "RSS";
      host = host.slice(0, 1).toUpperCase() + host.slice(1);
    } catch {
      /* ignore */
    }
    i += 1;
    out.push({ id: `extra-${i}`, label: host, url, categoryDefault: "macro" });
  }
  return out;
}

function decodeXmlText(s: string): string {
  return s
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/gi, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\u0022")
    .replace(/&#39;/g, "\u0027")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCharCode(parseInt(h, 16)))
    .trim();
}

function extractItemLink(block: string): string {
  const plain = block.match(/<link>([\s\S]*?)<\/link>/i)?.[1];
  if (plain) return decodeXmlText(plain);
  const href = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*\/?>/i)?.[1];
  if (href) return decodeXmlText(href);
  const guid = block.match(/<guid[^>]*>([\s\S]*?)<\/guid>/i)?.[1];
  if (guid) return decodeXmlText(guid);
  return "";
}

function parseRssItems(
  xml: string,
  opts: { source: string; category: string; symbols: string[]; cap: number },
): NewsItem[] {
  const items: NewsItem[] = [];
  const blocks = xml.match(/<item>([\s\S]*?)<\/item>/gi) ?? [];
  for (const b of blocks.slice(0, opts.cap)) {
    const rawTitle =
      b.match(/<title><!\[CDATA\[([\s\S]*?)\]\]><\/title>/i)?.[1] ??
      b.match(/<title>([\s\S]*?)<\/title>/i)?.[1] ??
      "";
    const title = decodeXmlText(rawTitle).replace(/<[^>]+>/g, "").trim();
    const link = extractItemLink(b);
    const rawDate =
      b.match(/<pubDate>([\s\S]*?)<\/pubDate>/i)?.[1] ??
      b.match(/<dc:date>([\s\S]*?)<\/dc:date>/i)?.[1] ??
      "";
    const pubDate = decodeXmlText(rawDate).trim();
    if (!title || !link) continue;
    items.push({
      title,
      link,
      pubDate: pubDate || new Date(0).toUTCString(),
      symbols: [...opts.symbols],
      category: opts.category,
      source: opts.source,
    });
  }
  return items;
}

function canonicalLink(href: string): string {
  try {
    const u = new URL(href);
    for (const k of ["utm_source", "utm_medium", "utm_campaign", "utm_term", "utm_content", "icid"]) {
      u.searchParams.delete(k);
    }
    return u.toString();
  } catch {
    return href.trim();
  }
}

function titleFingerprint(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .slice(0, 160);
}

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function headlineMatchesSymbol(title: string, sym: string, companyName: string | null): boolean {
  const t = title;
  const upper = t.toUpperCase();
  const s = sym.toUpperCase();
  if (upper.includes(`$${s}`)) return true;
  if (s.length <= 2) return false;
  const re = new RegExp(`\\b${escapeRe(s)}\\b`, "i");
  if (re.test(t)) return true;
  const cn = (companyName ?? "").trim();
  if (cn.length < 4) return false;
  const parts = cn.split(/\s+/).filter((w) => w.length > 3);
  for (const w of parts) {
    if (t.toLowerCase().includes(w.toLowerCase())) return true;
  }
  return false;
}

async function fetchText(url: string): Promise<string | null> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), FETCH_TIMEOUT_MS);
  try {
    const resp = await fetch(url, {
      signal: ctrl.signal,
      headers: { "User-Agent": "finance-hub-terminal/1.0 (+local)" },
      redirect: "follow",
    });
    if (!resp.ok) return null;
    return await resp.text();
  } catch {
    return null;
  } finally {
    clearTimeout(t);
  }
}

async function fetchSymbolNews(sym: string, category: string): Promise<NewsItem[]> {
  const s = normSym(sym);
  if (!s) return [];
  const url = `https://feeds.finance.yahoo.com/rss/2.0/headline?s=${encodeURIComponent(s)}&region=US&lang=en-US`;
  const hit = cache.get(url);
  if (hit && hit.expiresAt > Date.now()) return hit.items;

  const xml = await fetchText(url);
  if (!xml) return [];
  const items = parseRssItems(xml, {
    source: "Yahoo",
    category,
    symbols: [s],
    cap: MAX_YAHOO_PER_SYMBOL,
  });
  cache.set(url, { expiresAt: Date.now() + TTL_MS, items });
  return items;
}

async function fetchMacroFeed(feed: StaticFeed): Promise<NewsItem[]> {
  const hit = cache.get(feed.url);
  if (hit && hit.expiresAt > Date.now()) return hit.items;

  const xml = await fetchText(feed.url);
  if (!xml) {
    cache.set(feed.url, { expiresAt: Date.now() + TTL_MS, items: [] });
    return [];
  }
  const items = parseRssItems(xml, {
    source: feed.label,
    category: feed.categoryDefault,
    symbols: [],
    cap: MAX_PER_FEED,
  });
  cache.set(feed.url, { expiresAt: Date.now() + TTL_MS, items });
  return items;
}

function mergeDeduped(items: NewsItem[]): NewsItem[] {
  const byLink = new Map<string, NewsItem>();
  const seenTitles = new Set<string>();

  for (const it of items) {
    const linkKey = canonicalLink(it.link);
    const fp = titleFingerprint(it.title);
    const prev = byLink.get(linkKey);
    if (prev) {
      prev.symbols = Array.from(new Set([...prev.symbols, ...it.symbols]));
      continue;
    }
    if (seenTitles.has(fp)) continue;
    seenTitles.add(fp);
    byLink.set(linkKey, { ...it, link: linkKey });
  }

  return Array.from(byLink.values()).sort((a, b) => {
    const da = Date.parse(a.pubDate) || 0;
    const db = Date.parse(b.pubDate) || 0;
    return db - da;
  });
}

export async function GET(req: Request) {
  const url = new URL(req.url);
  const mode = (url.searchParams.get("mode") ?? "").toLowerCase();
  const symbols = (url.searchParams.get("symbols") ?? "")
    .split(",")
    .map(normSym)
    .filter(Boolean);
  const anomalySymbols = (url.searchParams.get("anomalies") ?? "")
    .split(",")
    .map(normSym)
    .filter(Boolean);
  const companyNameRaw = url.searchParams.get("companyName");
  const companyName =
    companyNameRaw && companyNameRaw.trim().length > 0 ? companyNameRaw.trim() : null;

  const macro = ["SPY", "QQQ", "DIA", "IWM", "XLK", "XLF", "XLE", "XLV", "XLY", "XLP", "XLU", "XLI"];

  const focus = Array.from(new Set(symbols)).slice(0, 8);
  const anoms = Array.from(new Set(anomalySymbols)).slice(0, 8);

  const macroFeeds = [...DEFAULT_MACRO_FEEDS, ...extraFeedsFromEnv()];

  if (mode === "company") {
    const sym = focus[0] ?? "";
    const yahoo = sym ? await fetchSymbolNews(sym, "company") : [];
    const globalFeeds = await Promise.allSettled(macroFeeds.map((f) => fetchMacroFeed(f)));
    const globalItems = globalFeeds.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
    const filtered = sym
      ? globalItems.filter((it) => headlineMatchesSymbol(it.title, sym, companyName))
      : [];
    const merged = mergeDeduped([...yahoo, ...filtered]).slice(0, MAX_RESPONSE_ITEMS);
    return NextResponse.json({ ok: true, mode: "company", items: merged });
  }

  const yahooSets = await Promise.all([
    ...focus.map((s) => fetchSymbolNews(s, "watchlist")),
    ...anoms.map((s) => fetchSymbolNews(s, "highVolume")),
    ...macro.slice(0, 6).map((s) => fetchSymbolNews(s, "macro")),
  ]);
  const globalFeeds = await Promise.allSettled(macroFeeds.map((f) => fetchMacroFeed(f)));

  const yahooItems = yahooSets.flat();
  const globalItems = globalFeeds.flatMap((r) => (r.status === "fulfilled" ? r.value : []));
  const merged = mergeDeduped([...yahooItems, ...globalItems]).slice(0, MAX_RESPONSE_ITEMS);

  return NextResponse.json({ ok: true, mode: mode || "default", items: merged });
}
