import { logError } from "@/lib/log";
import { normTicker, prettifyIssuerName } from "@/lib/openData/issuerDisplayName";

const OPENFIGI_CHUNK = 40;

type OpenFigiRow = {
  data?: Array<{
    name?: string;
    ticker?: string;
    exchCode?: string;
    securityType?: string;
  }>;
  warning?: string;
};

function pickNameFromHits(hits: NonNullable<OpenFigiRow["data"]>): string | null {
  if (!hits.length) return null;
  const common =
    hits.find((d) => d.exchCode === "US" && d.securityType === "Common Stock") ??
    hits.find((d) => d.exchCode === "US") ??
    hits[0];
  const raw = common?.name?.trim();
  return raw ? prettifyIssuerName(raw) : null;
}

/**
 * Resolve display issuer names via OpenFIGI mapping API (no API key for light use).
 * Request order matches response order; only US listings are preferred when multiple exist.
 */
export async function resolveCompanyNamesOpenFigi(symbols: string[]): Promise<Record<string, string | null>> {
  const out: Record<string, string | null> = {};
  const unique = [...new Set(symbols.map(normTicker).filter(Boolean))];
  for (const s of unique) out[s] = null;
  if (unique.length === 0) return out;

  for (let i = 0; i < unique.length; i += OPENFIGI_CHUNK) {
    const slice = unique.slice(i, i + OPENFIGI_CHUNK);
    const jobs = slice.map((sym) => ({ idType: "TICKER", idValue: sym, exchCode: "US" }));
    try {
      const resp = await fetch("https://api.openfigi.com/v3/mapping", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(jobs),
      });
      if (!resp.ok) continue;
      const json = (await resp.json()) as OpenFigiRow[];
      if (!Array.isArray(json)) continue;
      slice.forEach((sym, idx) => {
        const row = json[idx];
        const name = row?.data?.length ? pickNameFromHits(row.data) : null;
        if (name) out[sym] = name;
      });
    } catch (e) {
      logError("openfigi_mapping_chunk", e);
    }
  }

  return out;
}
