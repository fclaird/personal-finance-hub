import { cleanIssuerSearchName, toConciseBusinessSummary } from "@/lib/dividendModels/conciseSummary";
import { readSymbolNarrativeOverrideForSymbol } from "@/lib/dividendModels/symbolNarrativeOverride";
import { logError } from "@/lib/log";
import { fetchYahooLongBusinessSummary } from "@/lib/market/yahooAssetProfile";
import { resolveIssuerIdentity } from "@/lib/openData/resolveIssuerIdentity";
import {
  fetchOpenSourceDescriptions,
  openSourceSearchQueries,
} from "@/lib/dividendModels/openSourceNarrativeLookup";
import { fetchSecBusinessExcerpt } from "@/lib/sec/secBusinessExcerpt";
import { fetchSchwabInstrumentFundamental } from "@/lib/schwab/instrumentFundamental";

function inferPreferFundFiling(
  sector: string | null,
  industry: string | null,
  companyName: string | null,
): boolean {
  const s = `${sector ?? ""} ${industry ?? ""} ${companyName ?? ""}`.toLowerCase();
  return (
    /\betf\b/.test(s) ||
    s.includes("fund") ||
    s.includes("closed-end") ||
    s.includes("mutual") ||
    /unit investment trust/.test(s) ||
    (s.includes("trust") && (s.includes("spdr") || s.includes("ishares") || s.includes("etf")))
  );
}

function splitIntoParagraphs(text: string, maxParas = 3, minLen = 60): string[] {
  const sentences = text.split(/(?<=[.!?])\s+/).filter((s) => s.length > 30);
  const chunks: string[] = [];
  let buf = "";
  for (const s of sentences) {
    const next = buf ? `${buf} ${s}` : s;
    if (next.length > 520 && buf) {
      chunks.push(buf.trim());
      buf = s;
      if (chunks.length >= maxParas) break;
    } else {
      buf = next;
    }
  }
  if (buf && chunks.length < maxParas) chunks.push(buf.trim());
  if (chunks.length === 0 && text.length >= minLen) return [text.slice(0, 800)];
  return chunks;
}

export type NarrativeContentSource =
  | "override"
  | "sec"
  | "yahoo"
  | "wikidata"
  | "wiki"
  | "fallback"
  | "mixed";

type NarrativePick = {
  businessSummary: string;
  contentSource: NarrativeContentSource;
};

function sectorFallbackSummary(
  sym: string,
  companyName: string | null,
  sector: string | null,
  industry: string | null,
  preferFund?: boolean,
): string | null {
  const label = companyName && companyName !== sym ? companyName : sym;
  if (preferFund) {
    return `${label} (${sym}) is an exchange-traded fund or trust listed in the U.S. See the SEC filing section below for the fund’s stated investment objective.`;
  }
  if (!sector && !industry) return null;
  return `${label} (${sym}) is classified in the ${sector ?? "reported"} sector${industry ? ` (${industry})` : ""} per market-data feeds.`;
}

/** Manual override → Yahoo → Wikidata → Wikipedia → Schwab sector/industry one-liner. */
function pickOpenSourceNarrative(opts: {
  sym: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  manualOverride: string | null;
  yahooSummary: string | null;
  wikidataDescription: string | null;
  wikiIntro: string | null;
  preferFund?: boolean;
}): NarrativePick {
  const { sym, companyName, sector, industry, manualOverride, yahooSummary, wikidataDescription, wikiIntro, preferFund } =
    opts;

  if (manualOverride && manualOverride.length >= 20) {
    return { businessSummary: toConciseBusinessSummary(manualOverride), contentSource: "override" };
  }
  if (yahooSummary && yahooSummary.length >= 40) {
    return { businessSummary: toConciseBusinessSummary(yahooSummary), contentSource: "yahoo" };
  }
  if (wikidataDescription && wikidataDescription.length >= 20) {
    return { businessSummary: toConciseBusinessSummary(wikidataDescription), contentSource: "wikidata" };
  }
  if (wikiIntro && wikiIntro.length >= 40) {
    return { businessSummary: toConciseBusinessSummary(wikiIntro), contentSource: "wiki" };
  }
  const sectorLine = sectorFallbackSummary(sym, companyName, sector, industry, preferFund);
  if (sectorLine) {
    return { businessSummary: sectorLine, contentSource: "fallback" };
  }

  const label = companyName && companyName !== sym ? companyName : sym;
  return {
    businessSummary: `${label} (${sym}): business description not available from Schwab, Yahoo Finance, or other open sources.`,
    contentSource: "fallback",
  };
}

export type SymbolNarrativeResult = {
  symbol: string;
  companyName: string | null;
  sector: string | null;
  industry: string | null;
  /** Short blurb for “What they do” (open sources only). */
  businessSummary: string;
  paragraphs: string[];
  sources: string[];
  contentSource: NarrativeContentSource;
  yahooProfileUrl: string | null;
  /** Excerpt for the separate SEC filing tile. */
  secFilingSummary: string | null;
  secForm: string | null;
  secFilingDate: string | null;
  secDocumentUrl: string | null;
  secCik: string | null;
  secAccession: string | null;
};

export async function buildSymbolNarrative(symbol: string): Promise<SymbolNarrativeResult> {
  const sym = (symbol ?? "").trim().toUpperCase();
  const manualOverride = readSymbolNarrativeOverrideForSymbol(sym);

  const f = await fetchSchwabInstrumentFundamental(sym);
  const identity = await resolveIssuerIdentity(sym, { schwabCompanyName: f.companyName });
  const companyName = identity.displayName ?? f.companyName;
  let sector = f.sector;
  let industry = f.industry;
  const sources: string[] = ["Schwab instrument fundamentals"];
  if (identity.nameSource === "openfigi" && identity.displayName) {
    sources.push(`OpenFIGI (${identity.displayName})`);
  }

  if (manualOverride) {
    sources.unshift("Manual narrative override");
  }

  let secExcerpt: string | null = null;
  let secForm: string | null = null;
  let secFilingDate: string | null = null;
  let secDocumentUrl: string | null = null;
  let secCik: string | null = null;
  let secAccession: string | null = null;

  let yahooSummary: string | null = null;
  let yahooProfileUrl: string | null = `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}/profile/`;

  let preferFund = inferPreferFundFiling(sector, industry, companyName);
  if (/etf|trust/i.test(companyName ?? "") || /etf|trust/i.test(identity.displayName ?? "")) {
    preferFund = true;
  }

  if (!manualOverride) {
    const [secResult, yahooResult] = await Promise.all([
      fetchSecBusinessExcerpt(sym, { preferFund }).catch((e) => {
        logError("symbol_narrative_sec", e);
        return null;
      }),
      fetchYahooLongBusinessSummary(sym).catch((e) => {
        logError("symbol_narrative_yahoo", e);
        return null;
      }),
    ]);

    if (secResult) {
      secExcerpt = secResult.excerpt;
      secForm = secResult.form;
      secFilingDate = secResult.filingDate;
      secDocumentUrl = secResult.documentUrl;
      secAccession = secResult.accessionNumber;
      secCik = String(secResult.cik);
    }

    if (yahooResult?.summary) {
      yahooSummary = yahooResult.summary;
      yahooProfileUrl = yahooResult.profileUrl;
      if (!sector && yahooResult.sector) sector = yahooResult.sector;
      if (!industry && yahooResult.industry) industry = yahooResult.industry;
    }
  }

  let wikidataDescription: string | null = null;
  let wikiIntro: string | null = null;
  if (!manualOverride && !yahooSummary) {
    const queries = openSourceSearchQueries(sym, identity, companyName, preferFund);
    try {
      const open = await fetchOpenSourceDescriptions(queries);
      wikidataDescription = open.wikidataDescription;
      wikiIntro = open.wikiIntro;
      if (wikidataDescription) sources.push("Wikidata (entity description)");
      if (wikiIntro) sources.push("Wikipedia (summary)");
    } catch (e) {
      logError("symbol_narrative_wiki", e);
    }
  }

  const picked = pickOpenSourceNarrative({
    sym,
    companyName,
    sector,
    industry,
    manualOverride,
    yahooSummary,
    wikidataDescription,
    wikiIntro,
    preferFund,
  });
  const businessSummary = picked.businessSummary;

  if (picked.contentSource === "yahoo") {
    sources.push("Yahoo Finance (issuer profile)");
  }
  if (picked.contentSource === "fallback" && (sector || industry)) {
    sources.push("Schwab sector/industry classification");
  }

  const secFilingSummary =
    secExcerpt && secExcerpt.length >= 60
      ? toConciseBusinessSummary(secExcerpt, { maxChars: 720, maxSentences: 4 })
      : null;

  const paras = splitIntoParagraphs(businessSummary, 3, 40);
  if (paras.length === 0) paras.push(businessSummary);

  return {
    symbol: sym,
    companyName,
    sector,
    industry,
    businessSummary,
    paragraphs: paras,
    sources,
    contentSource: picked.contentSource,
    yahooProfileUrl: picked.contentSource === "yahoo" ? yahooProfileUrl : null,
    secFilingSummary,
    secForm,
    secFilingDate,
    secDocumentUrl,
    secCik,
    secAccession,
  };
}
