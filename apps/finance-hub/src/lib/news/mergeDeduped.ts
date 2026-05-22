import type { NewsItem } from "./types";

export function canonicalLink(href: string): string {
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

export function mergeDedupedNews(items: NewsItem[]): NewsItem[] {
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
