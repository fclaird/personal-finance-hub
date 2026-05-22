import { logError } from "@/lib/log";
import { lookupSecCompanyEntry } from "@/lib/openData/secCompanyTickers";
import { secFetchText } from "@/lib/sec/secFetch";

/** Operating-company annual/quarterly reports. */
export const OPERATING_FILING_FORMS = ["10-K", "10-K/A", "20-F", "10-Q", "10-Q/A"] as const;

/** IPO / registration statements (common before first 10-K). */
export const IPO_FILING_FORMS = ["S-1/A", "S-1", "F-1/A", "F-1", "424B4", "424B5"] as const;

/** Registered fund / ETF disclosure forms (prospectus-style narrative). */
export const FUND_FILING_FORMS = [
  "497",
  "497K",
  "485BPOS",
  "N-1A",
  "N-CSR",
  "N-CSRS",
  "N-2",
  "N-2/A",
  "POS EX",
] as const;

export type EdgarFilingRef = {
  cik: number;
  form: string;
  filingDate: string;
  accessionNumber: string;
  primaryDocument: string;
  documentUrl: string;
};

type SubmissionsRecent = {
  form?: string[];
  filingDate?: string[];
  accessionNumber?: string[];
  primaryDocument?: string[];
};

function padCik10(cik: number): string {
  return String(cik).replace(/\D/g, "").padStart(10, "0");
}

function cikPathSegment(cik: number): string {
  return String(cik).replace(/^0+/, "") || "0";
}

export function edgarDocumentUrl(cik: number, accessionNumber: string, primaryDocument: string): string {
  const accNoDash = accessionNumber.replace(/-/g, "");
  return `https://www.sec.gov/Archives/edgar/data/${cikPathSegment(cik)}/${accNoDash}/${primaryDocument}`;
}

function pickFromRecent(
  recent: SubmissionsRecent,
  formPriority: readonly string[],
): Omit<EdgarFilingRef, "cik" | "documentUrl"> | null {
  const forms = recent.form ?? [];
  const dates = recent.filingDate ?? [];
  const accessions = recent.accessionNumber ?? [];
  const docs = recent.primaryDocument ?? [];

  for (const want of formPriority) {
    for (let i = 0; i < forms.length; i++) {
      if (forms[i] !== want) continue;
      const accessionNumber = accessions[i];
      const primaryDocument = docs[i];
      const filingDate = dates[i];
      if (!accessionNumber || !primaryDocument || !filingDate) continue;
      return { form: want, filingDate, accessionNumber, primaryDocument };
    }
  }
  return null;
}

export async function fetchEdgarSubmissions(cik: number): Promise<{
  recent: SubmissionsRecent;
  name?: string;
} | null> {
  const url = `https://data.sec.gov/submissions/CIK${padCik10(cik)}.json`;
  try {
    const text = await secFetchText(url);
    if (!text) return null;
    const json = JSON.parse(text) as {
      name?: string;
      filings?: { recent?: SubmissionsRecent };
    };
    const recent = json.filings?.recent;
    if (!recent?.form?.length) return null;
    return { recent, name: json.name };
  } catch (e) {
    logError("edgar_submissions_fetch", e);
    return null;
  }
}

const NARRATIVE_FORM_PRIORITY = [
  ...OPERATING_FILING_FORMS,
  ...IPO_FILING_FORMS,
  ...FUND_FILING_FORMS,
] as const;

export function listNarrativeFilingCandidates(
  recent: SubmissionsRecent,
  opts?: { preferFund?: boolean; limit?: number },
): Omit<EdgarFilingRef, "cik" | "documentUrl">[] {
  const limit = opts?.limit ?? 6;
  const preferFund = opts?.preferFund === true;
  const order = preferFund
    ? ([...FUND_FILING_FORMS, ...OPERATING_FILING_FORMS, ...IPO_FILING_FORMS] as const)
    : NARRATIVE_FORM_PRIORITY;
  const out: Omit<EdgarFilingRef, "cik" | "documentUrl">[] = [];
  const seen = new Set<string>();
  for (const want of order) {
    const forms = recent.form ?? [];
    const dates = recent.filingDate ?? [];
    const accessions = recent.accessionNumber ?? [];
    const docs = recent.primaryDocument ?? [];
    for (let i = 0; i < forms.length; i++) {
      if (forms[i] !== want) continue;
      const accessionNumber = accessions[i];
      const primaryDocument = docs[i];
      const filingDate = dates[i];
      if (!accessionNumber || !primaryDocument || !filingDate) continue;
      if (seen.has(accessionNumber)) continue;
      seen.add(accessionNumber);
      out.push({ form: want, filingDate, accessionNumber, primaryDocument });
      if (out.length >= limit) return out;
    }
  }
  return out;
}

export function pickLatestNarrativeFiling(
  recent: SubmissionsRecent,
  opts?: { preferFund?: boolean },
): Omit<EdgarFilingRef, "cik" | "documentUrl"> | null {
  return listNarrativeFilingCandidates(recent, { ...opts, limit: 1 })[0] ?? null;
}

export async function listLatestNarrativeFilings(
  symbol: string,
  opts?: { preferFund?: boolean; limit?: number },
): Promise<EdgarFilingRef[]> {
  const entry = await lookupSecCompanyEntry(symbol);
  if (!entry) return [];
  const subs = await fetchEdgarSubmissions(entry.cik);
  if (!subs) return [];
  return listNarrativeFilingCandidates(subs.recent, opts).map((picked) => ({
    cik: entry.cik,
    ...picked,
    documentUrl: edgarDocumentUrl(entry.cik, picked.accessionNumber, picked.primaryDocument),
  }));
}

export async function resolveLatestNarrativeFiling(
  symbol: string,
  opts?: { preferFund?: boolean },
): Promise<EdgarFilingRef | null> {
  const list = await listLatestNarrativeFilings(symbol, { ...opts, limit: 1 });
  return list[0] ?? null;
}

export async function latestNarrativeFilingDate(symbol: string): Promise<string | null> {
  const entry = await lookupSecCompanyEntry(symbol);
  if (!entry) return null;
  const subs = await fetchEdgarSubmissions(entry.cik);
  if (!subs) return null;
  const picked = pickLatestNarrativeFiling(subs.recent);
  return picked?.filingDate ?? null;
}
