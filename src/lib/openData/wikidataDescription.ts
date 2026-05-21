import { logError } from "@/lib/log";

const UA = "FinanceHub/1.0 (local; issuer narrative)";

type WikidataSearchHit = {
  id?: string;
  label?: string;
  description?: string;
};

/**
 * Short entity description from Wikidata (e.g. "American software and services company…").
 */
export async function fetchWikidataDescription(searchQuery: string): Promise<string | null> {
  const q = (searchQuery ?? "").trim();
  if (q.length < 4) return null;

  try {
    const url = new URL("https://www.wikidata.org/w/api.php");
    url.searchParams.set("action", "wbsearchentities");
    url.searchParams.set("search", q);
    url.searchParams.set("language", "en");
    url.searchParams.set("limit", "3");
    url.searchParams.set("format", "json");

    const resp = await fetch(url.toString(), { headers: { "User-Agent": UA } });
    if (!resp.ok) return null;

    const json = (await resp.json()) as { search?: WikidataSearchHit[] };
    const hits = json.search ?? [];
    const best =
      hits.find((h) => h.description && h.description.length >= 30) ??
      hits.find((h) => h.description && h.description.length >= 15);
    const desc = best?.description?.replace(/\s+/g, " ").trim();
    return desc && desc.length >= 15 ? desc : null;
  } catch (e) {
    logError("wikidata_description", e);
    return null;
  }
}
