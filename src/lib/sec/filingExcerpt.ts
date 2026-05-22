import { logError } from "@/lib/log";

import type { EdgarFilingRef } from "./edgarSubmissions";
import { secFetchText } from "./secFetch";

const MAX_EXCERPT_CHARS = 4500;

function stripHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, " ")
    .replace(/<style[\s\S]*?<\/style>/gi, " ")
    .replace(/<\/(p|div|br|tr|li|h\d)>/gi, "\n")
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&lt;/gi, "<")
    .replace(/&gt;/gi, ">")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\r/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
}

function normalizePlain(text: string): string {
  return text.replace(/\r/g, "\n").replace(/[ \t]{2,}/g, " ").replace(/\n{3,}/g, "\n\n").trim();
}

function sliceBetween(text: string, startRe: RegExp, endRe: RegExp): string | null {
  return sliceBetweenBest(text, startRe, endRe, 80);
}

/** Prefer the longest section (skips table-of-contents hits). */
function sliceBetweenBest(
  text: string,
  startRe: RegExp,
  endRe: RegExp,
  minChunkLen = 200,
): string | null {
  const flags = startRe.flags.includes("g") ? startRe.flags : `${startRe.flags}g`;
  const startGlobal = new RegExp(startRe.source, flags);
  let best: string | null = null;
  let m: RegExpExecArray | null;
  while ((m = startGlobal.exec(text)) !== null) {
    const rest = text.slice(m.index);
    const end = rest.search(endRe);
    const chunk = (end > 0 ? rest.slice(0, end) : rest).trim();
    if (chunk.length < minChunkLen) continue;
    if (!best || chunk.length > best.length) best = chunk;
  }
  return best;
}

function denudeHtmlFrags(text: string): string {
  return text
    .replace(/<[^>]+>/g, " ")
    .replace(/&nbsp;/gi, " ")
    .replace(/&amp;/gi, "&")
    .replace(/&reg;/gi, "")
    .replace(/&trade;/gi, "")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/\s+/g, " ")
    .trim();
}

function dropWeakLeadSentences(text: string): string {
  const sentences = normalizePlain(text).split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 10);
  const weakLead =
    /^(thus|therefore|however|furthermore|accordingly|consequently|as a result)\b/i;
  let i = 0;
  while (i < sentences.length && weakLead.test(sentences[i].trim())) i += 1;
  return sentences.slice(i).join(" ").trim();
}

function scoreFundExcerpt(text: string): number {
  const t = text.toLowerCase();
  let score = 0;
  if (/seeks to (provide|track|achieve)/i.test(text)) score += 35;
  if (/correspond generally to/i.test(text)) score += 25;
  if (/exchange[- ]traded fund|\betf\b|unit investment trust/i.test(t)) score += 12;
  if (/^(thus|therefore|however|furthermore|accordingly)\b/i.test(text.trim())) score -= 50;
  if (/index securities held by the trust will passively/i.test(t)) score -= 25;
  if (text.length >= 120 && text.length <= 6000) score += 8;
  return score;
}

function scoreBusinessExcerpt(text: string): number {
  const head = text.slice(0, 280).toLowerCase();
  const t = text.toLowerCase();
  let score = 0;
  if (/\d+\s+Overview\s+\d+\s+The\b/i.test(text)) score -= 80;
  if ((text.match(/\bItem\s*\d/gi) ?? []).length >= 3 && text.length < 600) score -= 70;
  if (/\b(overview|we are a|we are an|our company is|we provide|we develop|we offer|we operate)\b/.test(head)) {
    score += 28;
  }
  if (/\b(platform|cloud|software|services?|products?|customers?|revenue|artificial intelligence|\bai\b)/.test(t)) {
    score += 12;
  }
  if (
    /\bequity award|participating subsidiary|exercise price|business unit equity|stock option plan|no participant\b/.test(
      t,
    )
  ) {
    score -= 70;
  }
  if (/\bwe may also grant\b/.test(t) && /\baward/.test(t)) score -= 50;
  if (/forward-looking statements|safe harbor/i.test(t)) score -= 80;
  if (/^this annual report on form 10-k/i.test(head)) score -= 60;
  if (text.length >= 180 && text.length <= 14_000) score += 10;
  return score;
}

function excerptQualityScore(excerpt: string, form: string): number {
  if (/^(497|485|N-1|N-2|N-CS)/i.test(form)) return scoreFundExcerpt(excerpt);
  return scoreBusinessExcerpt(excerpt);
}

function pickBestBusinessExcerpt(candidates: string[]): string | null {
  let best: { excerpt: string; score: number } | null = null;
  for (const raw of candidates) {
    if (!raw || raw.length < 80) continue;
    const body = denudeHtmlFrags(
      raw
        .replace(/^(ITEM\s*1[\s.:–-]*BUSINESS|BUSINESS|4\.\s*Information on the Company)\s*/i, "")
        .trim(),
    );
    const excerpt = firstParagraphs(body, MAX_EXCERPT_CHARS);
    if (excerpt.length < 60) continue;
    const score = scoreBusinessExcerpt(excerpt);
    if (score < 5) continue;
    if (!best || score > best.score) best = { excerpt, score };
  }
  return best?.excerpt ?? null;
}

function firstParagraphs(text: string, maxChars: number): string {
  const cleaned = dropWeakLeadSentences(text);
  if (cleaned.length <= maxChars) return cleaned;
  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter((s) => s.length > 25);
  let out = "";
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > maxChars && out) break;
    out = next;
    if (out.length >= maxChars * 0.75) break;
  }
  if (out.length > maxChars) return out.slice(0, maxChars - 1).trimEnd() + "…";
  return out || cleaned.slice(0, maxChars - 1).trimEnd() + "…";
}

function extractProspectusBusiness(plain: string): string | null {
  const blocks = [
    sliceBetweenBest(plain, /ITEM\s*1[\s.:–-]*BUSINESS/i, /ITEM\s*1A|RISK FACTORS/i, 200),
    sliceBetween(plain, /(?:^|\n)\s*BUSINESS\s*\n/i, /RISK FACTORS|INDUSTRY BACKGROUND/i),
    sliceBetween(plain, /PROSPECTUS SUMMARY/i, /THE OFFERING|RISK FACTORS|SUMMARY RISK/i),
    sliceBetween(plain, /Overview of Our Company/i, /Risk Factors|Industry/i),
  ].filter((b): b is string => Boolean(b));
  return pickBestBusinessExcerpt(blocks);
}

function extractOperatingBusiness(plain: string): string | null {
  const blocks = [
    sliceBetweenBest(plain, /ITEM\s*1[\s.:–-]*BUSINESS/i, /ITEM\s*1A[\s.:–-]*RISK/i, 200),
    sliceBetweenBest(plain, /PART\s+I[\s\S]{0,80}?ITEM\s*1[\s.:–-]*BUSINESS/i, /ITEM\s*1A/i, 200),
  ].filter((b): b is string => Boolean(b));
  return pickBestBusinessExcerpt(blocks);
}

/** Foreign private issuers (20-F / 40-F): Item 4 “Information on the Company”. */
function extract20FBusiness(plain: string): string | null {
  const endRe = /Item\s*5[\s.:–-]*Operating|Item\s*5A|Item\s*6[\s.:–-]*Directors|Item\s*3[\s.:–-]*Key Information/i;
  const blocks = [
    sliceBetweenBest(plain, /4\.\s*Information on the Company/i, endRe, 400),
    sliceBetweenBest(plain, /Item\s*4[\s.:–-]*Information on the Company/i, endRe, 400),
    sliceBetweenBest(
      plain,
      /History and Development of the Company/i,
      /Organizational Structure|Principal Activities|Item\s*4A/i,
      300,
    ),
  ].filter((b): b is string => Boolean(b));
  return pickBestBusinessExcerpt(blocks);
}

/** ETF / trust 10-K: narrative after trust formation (HTML filings embedded in full .txt). */
function extractTrust10KOverview(plain: string): string | null {
  const blocks = [
    sliceBetweenBest(
      plain,
      /was formed as a (?:Delaware|Maryland) (?:statutory )?trust/i,
      /Item\s*1A[\s.:–-]*Risk|Risk Factors|The Gold Industry|Creation and Redemption/i,
      250,
    ),
    sliceBetweenBest(plain, /The Trust seeks to/i, /Item\s*1A|Risk Factors|Fees and Expenses/i, 200),
  ].filter((b): b is string => Boolean(b));
  return pickBestBusinessExcerpt(blocks);
}

function extractFundNarrative(plain: string): string | null {
  const candidates: string[] = [];
  const sectionPatterns: Array<[RegExp, RegExp]> = [
    [
      /Investment Objective\s+The Trust seeks to/i,
      /Fees and Expenses|Principal Investment Strateg|Portfolio Management/i,
    ],
    [
      /seeks to provide investment results that,?\s+before expenses/i,
      /Principal Investment Strateg|Fees and Expenses|Portfolio Management/i,
    ],
    [/fund\s+summary/i, /investment\s+objective|principal\s+investment/i],
    [/principal\s+investment\s+strateg/i, /investment\s+risks|management\s+of\s+the\s+fund|portfolio\s+holdings/i],
    [/investment\s+goal/i, /principal\s+investment|fees\s+and\s+expenses/i],
    [/investment\s+objective/i, /principal\s+investment\s+strateg/i],
  ];
  for (const [start, end] of sectionPatterns) {
    const chunk = sliceBetweenBest(plain, start, end, 120);
    if (chunk && chunk.length > 80) candidates.push(denudeHtmlFrags(chunk));
  }
  const seeks = plain.search(/seeks to provide investment results that,?\s+before expenses/i);
  if (seeks >= 0) {
    candidates.push(denudeHtmlFrags(plain.slice(seeks, seeks + 2800)));
  }

  let best: { excerpt: string; score: number } | null = null;
  for (const raw of candidates) {
    const body = raw
      .replace(/^investment objective\.?\s*/i, "")
      .replace(/^the trust\s+/i, "The Trust ")
      .trim();
    const excerpt = firstParagraphs(body, MAX_EXCERPT_CHARS);
    if (excerpt.length < 60) continue;
    const score = scoreFundExcerpt(excerpt);
    if (!best || score > best.score) best = { excerpt, score };
  }
  return best?.excerpt ?? null;
}

function extractFromPlain(plain: string, form: string): string | null {
  const fundish = /^(497|485|N-1|N-2|N-CS)/i.test(form);
  const ipoish = /^(S-1|F-1|424B)/i.test(form);
  const foreignAnnual = /^(20-F|40-F)/i.test(form);
  if (fundish) {
    return extractFundNarrative(plain) ?? extractProspectusBusiness(plain) ?? extractOperatingBusiness(plain);
  }
  if (foreignAnnual) {
    return extract20FBusiness(plain) ?? extractOperatingBusiness(plain) ?? extractProspectusBusiness(plain);
  }
  if (ipoish) {
    return extractProspectusBusiness(plain) ?? extractOperatingBusiness(plain) ?? extractFundNarrative(plain);
  }
  const trust10k = extractTrust10KOverview(plain);
  return (
    trust10k ??
    extractOperatingBusiness(plain) ??
    extractProspectusBusiness(plain) ??
    extractFundNarrative(plain)
  );
}

function fullSubmissionTxtUrls(filing: EdgarFilingRef): string[] {
  const accNoDash = filing.accessionNumber.replace(/-/g, "");
  const cikSeg = String(filing.cik).replace(/^0+/, "") || "0";
  const base = `https://www.sec.gov/Archives/edgar/data/${cikSeg}/${accNoDash}`;
  return [`${base}/${filing.accessionNumber}.txt`, `${base}/${accNoDash}.txt`];
}

/** Full .txt submissions are plain SGML; only the fetched URL determines HTML vs text. */
function isSecHtmlDocument(documentUrl: string, raw: string): boolean {
  const url = documentUrl.toLowerCase();
  if (url.endsWith(".txt") || raw.trimStart().startsWith("<SEC-DOCUMENT>")) return false;
  if (url.endsWith(".htm") || url.endsWith(".html")) return true;
  return raw.includes("<html");
}

function narrativeDocumentUrls(filing: EdgarFilingRef): string[] {
  const primary = filing.documentUrl;
  const txts = fullSubmissionTxtUrls(filing);
  const preferTxtFirst = /^(10-K|10-Q|20-F|40-F)/i.test(filing.form);
  return preferTxtFirst ? [...txts, primary] : [primary, ...txts];
}

async function loadFilingPlainText(filing: EdgarFilingRef, documentUrl: string): Promise<string | null> {
  try {
    const raw = await secFetchText(documentUrl, 20 * 1024 * 1024);
    if (!raw?.trim()) return null;
    const htmlish =
      isSecHtmlDocument(documentUrl, raw) ||
      raw.trimStart().startsWith("<SEC-DOCUMENT>") ||
      (documentUrl.toLowerCase().endsWith(".txt") && /<html[\s>]/i.test(raw));
    return htmlish ? stripHtml(raw) : normalizePlain(raw);
  } catch {
    return null;
  }
}

export type FilingExcerptResult = {
  excerpt: string;
  form: string;
  filingDate: string;
  documentUrl: string;
  accessionNumber: string;
  cik: number;
};

function excerptFromPlain(
  plain: string,
  filing: EdgarFilingRef,
  documentUrl: string,
): FilingExcerptResult | null {
  const excerpt = extractFromPlain(plain, filing.form);
  if (!excerpt || excerpt.length < 60) return null;
  return {
    excerpt,
    form: filing.form,
    filingDate: filing.filingDate,
    documentUrl,
    accessionNumber: filing.accessionNumber,
    cik: filing.cik,
  };
}

export async function fetchFilingExcerpt(filing: EdgarFilingRef): Promise<FilingExcerptResult | null> {
  try {
    const urls = narrativeDocumentUrls(filing);
    const seen = new Set<string>();
    let best: (FilingExcerptResult & { qualityScore: number }) | null = null;

    for (const url of urls) {
      if (seen.has(url)) continue;
      seen.add(url);
      const plain = await loadFilingPlainText(filing, url);
      if (!plain) continue;
      const result = excerptFromPlain(plain, filing, url);
      if (!result) continue;
      const qualityScore = excerptQualityScore(result.excerpt, filing.form);
      if (qualityScore < 5) continue;
      if (!best || qualityScore > best.qualityScore) {
        best = { ...result, qualityScore };
      }
    }

    if (!best) return null;
    const { qualityScore: _q, ...out } = best;
    return out;
  } catch (e) {
    logError("filing_excerpt_fetch", e);
    return null;
  }
}
