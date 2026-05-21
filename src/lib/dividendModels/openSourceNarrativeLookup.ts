import { cleanIssuerSearchName } from "@/lib/dividendModels/conciseSummary";
import { ETF_WIKI_ALIASES, isGarbledIssuerName } from "@/lib/dividendModels/etfWikiAliases";
import type { IssuerIdentity } from "@/lib/openData/resolveIssuerIdentity";
import { fetchWikidataDescription } from "@/lib/openData/wikidataDescription";
import { fetchWikipediaIntro, isLowQualityWikiText } from "@/lib/openData/wikipediaIntro";

/** Ordered issuer names to try on Wikidata / Wikipedia. */
export function openSourceSearchQueries(
  sym: string,
  identity: IssuerIdentity,
  companyName: string | null,
  preferFund: boolean,
): string[] {
  const queries: string[] = [];
  const add = (raw: string | null | undefined) => {
    const s = cleanIssuerSearchName((raw ?? "").trim());
    if (s.length < 4) return;
    if (queries.some((q) => q.toLowerCase() === s.toLowerCase())) return;
    queries.push(s);
  };

  const addVariants = (raw: string | null | undefined) => {
    add(raw);
    const s = cleanIssuerSearchName((raw ?? "").trim());
    const stripped = s.replace(/\s*,?\s*(N\.?V\.?|S\.?A\.?|PLC|Inc\.?|Corp\.?|Ltd\.?)\s*$/i, "").trim();
    if (stripped.length >= 4) add(stripped);
  };

  addVariants(identity.searchName);
  addVariants(identity.secEntry?.title);
  if (!isGarbledIssuerName(companyName)) addVariants(companyName);
  for (const alias of ETF_WIKI_ALIASES[sym] ?? []) add(alias);
  // Avoid "GIV ETF" → Givet commune; "GLDM ETF" → Gidget film — only when we have a real issuer name.
  const hasIssuerName = Boolean(
    (identity.searchName && identity.searchName.length >= 8) ||
      (companyName && companyName.length >= 8) ||
      identity.secEntry?.title,
  );
  if (preferFund && hasIssuerName && sym.length >= 4) {
    add(`${sym} exchange-traded fund`);
  }
  // Bare tickers (e.g. GIV, GLDM) match wrong Wikipedia pages; only use as last resort for longer symbols.
  if (queries.length === 0 && sym.length >= 5) add(sym);
  return queries;
}

export async function fetchOpenSourceDescriptions(queries: string[]): Promise<{
  wikidataDescription: string | null;
  wikiIntro: string | null;
}> {
  let bestWd: string | null = null;
  let bestWiki: string | null = null;

  for (const q of queries) {
    const wd = await fetchWikidataDescription(q);
    if (wd && (!bestWd || wd.length > bestWd.length)) bestWd = wd;
    const wp = await fetchWikipediaIntro(q);
    if (wp && wp.length >= 40 && !isLowQualityWikiText(wp)) {
      if (!bestWiki || wp.length > bestWiki.length) bestWiki = wp;
    }
  }

  if (
    bestWiki &&
    bestWiki.length >= 80 &&
    (!bestWd || bestWd.length < 100 || bestWiki.length > bestWd.length * 1.25)
  ) {
    return { wikidataDescription: null, wikiIntro: bestWiki };
  }
  if (bestWd) return { wikidataDescription: bestWd, wikiIntro: bestWiki };
  if (bestWiki) return { wikidataDescription: null, wikiIntro: bestWiki };
  return { wikidataDescription: null, wikiIntro: null };
}
