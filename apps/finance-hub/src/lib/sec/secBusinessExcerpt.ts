import { fetchFilingExcerpt } from "@/lib/sec/filingExcerpt";
import { listLatestNarrativeFilings } from "@/lib/sec/edgarSubmissions";

import type { FilingExcerptResult } from "./filingExcerpt";

/** Try several recent filings until a business-description excerpt parses. */
export async function fetchSecBusinessExcerpt(
  symbol: string,
  opts?: { preferFund?: boolean },
): Promise<FilingExcerptResult | null> {
  const filings = await listLatestNarrativeFilings(symbol, { ...opts, limit: 6 });
  for (const filing of filings) {
    const excerpt = await fetchFilingExcerpt(filing);
    if (excerpt) return excerpt;
  }
  return null;
}
