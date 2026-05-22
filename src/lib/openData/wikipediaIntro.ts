import { logError } from "@/lib/log";

const UA = "FinanceHub/1.0 (local; narrative fallback)";

type WikiSummary = {
  extract?: string;
  description?: string;
  title?: string;
  type?: string;
};

function tokenizeQuery(q: string): string[] {
  return q
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, " ")
    .split(/\s+/)
    .filter((t) => t.length >= 3 && !/^(inc|corp|ltd|etf|trust|the|and|for|usa|us)$/.test(t));
}

export function isLowQualityWikiText(text: string): boolean {
  const t = text.toLowerCase();
  return (
    /\bmay refer to\b/.test(t) ||
    /\bdisambiguation\b/.test(t) ||
    t.startsWith("an active galactic nucleus") ||
    /\bcommune in the\b/.test(t) ||
    /\bdepartment in (northern )?france\b/.test(t) ||
    /\bis a \d{4}\b.*\b(film|movie)\b/.test(t) ||
    /\bwas a commune\b/.test(t) ||
    /\blies on the river\b/.test(t) &&
      /\bborders\b/.test(t)
  );
}

function scoreWikiCandidate(
  query: string,
  title: string,
  summary: WikiSummary,
): number {
  const extract = (summary.extract ?? summary.description ?? "").replace(/\s+/g, " ").trim();
  if (extract.length < 40 || isLowQualityWikiText(extract)) return -100;

  const titleL = title.toLowerCase();
  const extractL = extract.toLowerCase();
  const tokens = tokenizeQuery(query);
  let score = 0;

  for (const tok of tokens) {
    if (titleL.includes(tok)) score += 12;
    if (extractL.includes(tok)) score += 6;
  }

  if (/\b(etf|exchange[- ]traded fund|trust|reit|holdings|corporation|company|inc\.)\b/.test(extractL)) {
    score += 18;
  }
  if (/\b(stock|shares|investment|fund|portfolio|assets under management)\b/.test(extractL)) {
    score += 10;
  }
  if (/\b(commune|department|municipality|arrondissement|river meuse)\b/.test(extractL)) score -= 40;
  if (/\b(film|movie|actor|actress|singer)\b/.test(extractL)) score -= 35;
  if (summary.type === "disambiguation") score -= 50;

  return score;
}

async function fetchWikiSummaryForTitle(title: string): Promise<WikiSummary | null> {
  const slug = title.replace(/ /g, "_");
  const summaryUrl = `https://en.wikipedia.org/api/rest_v1/page/summary/${encodeURIComponent(slug)}`;
  try {
    const summaryResp = await fetch(summaryUrl, { headers: { "User-Agent": UA } });
    if (!summaryResp.ok) return null;
    return (await summaryResp.json()) as WikiSummary;
  } catch {
    return null;
  }
}

/** Wikipedia lead — picks best opensearch hit, not the first. */
export async function fetchWikipediaIntro(searchQuery: string): Promise<string | null> {
  const q = (searchQuery ?? "").trim();
  if (q.length < 4) return null;

  const searchUrl = new URL("https://en.wikipedia.org/w/api.php");
  searchUrl.searchParams.set("action", "opensearch");
  searchUrl.searchParams.set("search", q);
  searchUrl.searchParams.set("limit", "8");
  searchUrl.searchParams.set("format", "json");

  try {
    const searchResp = await fetch(searchUrl.toString(), { headers: { "User-Agent": UA } });
    if (!searchResp.ok) return null;
    const searchJson = (await searchResp.json()) as [string, string[], string[], string[]];
    const titles = searchJson?.[1] ?? [];
    if (titles.length === 0) return null;

    let best: { extract: string; score: number } | null = null;

    for (const title of titles.slice(0, 6)) {
      const summary = await fetchWikiSummaryForTitle(title);
      if (!summary) continue;
      const extract = (summary.extract ?? summary.description ?? "").replace(/\s+/g, " ").trim();
      const score = scoreWikiCandidate(q, title, { ...summary, extract });
      if (score < 5) continue;
      if (!best || score > best.score) best = { extract, score };
    }

    return best?.extract ?? null;
  } catch (e) {
    logError("wikipedia_intro_fallback", e);
    return null;
  }
}
