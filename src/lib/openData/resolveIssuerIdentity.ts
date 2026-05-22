import { cleanIssuerSearchName } from "@/lib/dividendModels/conciseSummary";
import { resolveCompanyNamesOpenFigi } from "@/lib/openData/openFigiNames";
import { normTicker, prettifyIssuerName } from "@/lib/openData/issuerDisplayName";
import {
  lookupSecCompanyEntry,
  type SecCompanyEntry,
} from "@/lib/openData/secCompanyTickers";

export type IssuerNameSource = "schwab" | "sec" | "openfigi" | null;

export type IssuerIdentity = {
  symbol: string;
  /** Best display / search name for the issuer. */
  displayName: string | null;
  /** Name used for Wikipedia/Wikidata (≥4 chars when possible). */
  searchName: string | null;
  secEntry: SecCompanyEntry | null;
  nameSource: IssuerNameSource;
};

function cleanName(name: string | null | undefined): string | null {
  const s = (name ?? "").trim();
  if (!s) return null;
  const low = s.toLowerCase();
  if (low === "n/a" || low === "na" || low === "unknown") return null;
  return prettifyIssuerName(s);
}

/** True when ticker-only search is unreliable (e.g. O, BRK.B without a real name). */
export function needsIssuerNameSearch(symbol: string, companyName: string | null): boolean {
  const sym = normTicker(symbol);
  if (sym.length <= 3) return true;
  const n = (companyName ?? "").trim().toUpperCase();
  if (!n || n === sym || n.length <= 3) return true;
  return false;
}

/**
 * Resolve issuer display + search names: Schwab → SEC title → OpenFIGI.
 * SEC entry (CIK) is always looked up by ticker when available.
 */
export async function resolveIssuerIdentity(
  symbol: string,
  opts?: { schwabCompanyName?: string | null },
): Promise<IssuerIdentity> {
  const sym = normTicker(symbol);
  const secEntry = await lookupSecCompanyEntry(sym);

  let displayName = cleanName(opts?.schwabCompanyName);
  let nameSource: IssuerNameSource = displayName ? "schwab" : null;

  const secName = secEntry ? cleanName(secEntry.title) : null;
  if (secName && (needsIssuerNameSearch(sym, displayName) || !displayName)) {
    displayName = secName;
    nameSource = "sec";
  }

  if (needsIssuerNameSearch(sym, displayName)) {
    const figi = await resolveCompanyNamesOpenFigi([sym]);
    const fromFigi = cleanName(figi[sym]);
    if (fromFigi) {
      displayName = fromFigi;
      nameSource = "openfigi";
    }
  }

  const rawSearch =
    displayName && displayName.length >= 4
      ? displayName
      : secName && secName.length >= 4
        ? secName
        : null;
  const searchName = rawSearch ? cleanIssuerSearchName(rawSearch) : null;

  return {
    symbol: sym,
    displayName,
    searchName,
    secEntry,
    nameSource,
  };
}
