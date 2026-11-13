export type ReportCompany = {
  ticker: string;
  name: string;
  sector: string;
  blurb: string;
  marketCapUsd: number;
  marketCapText: string;
  corrSpy: number;
  corrQqq: number;
  corrWindow: "1y";
  corrShortHistory: boolean;
  corrHistoryNote: string | null;
  warExposure: string;
  warSourceUrl: string;
  warNote: string;
  warReportUnverified: boolean;
  cik: number | null;
  rankTop50: number | null;
  sectorRank: number | null;
  sources: string[];
  shareClassesCombined: boolean;
};

const GICS = new Set([
  "Information Technology",
  "Communication Services",
  "Consumer Discretionary",
  "Consumer Staples",
  "Health Care",
  "Financials",
  "Energy",
  "Industrials",
  "Materials",
  "Utilities",
  "Real Estate",
]);

const HEADER = new Set(["Rk", "Company", "Ticker", "Market cap", "What they do", "SPY / QQQ corr", "China/Taiwan", "Sector"]);

const TOP50_SOURCE = "report:top50_us_market_cap";
const TOP3_SOURCE = "report:top3_by_sector";

function parseCap(text: string): number {
  const match = text.replace(/,/g, "").trim().match(/^\$([0-9]+(?:\.[0-9]+)?)([TBM])$/);
  if (!match) throw new Error(`Unparsed market cap: ${text}`);
  const sig = match[1]!;
  const mult = match[2] === "T" ? 12 : match[2] === "B" ? 9 : 6;
  const dot = sig.indexOf(".");
  const digits = dot === -1 ? sig : sig.replace(".", "");
  const frac = dot === -1 ? 0 : sig.length - dot - 1;
  return Number(digits) * 10 ** (mult - frac);
}

function parseCorr(text: string): { spy: number; qqq: number } {
  const match = text.trim().match(/^(-?[0-9]+\.[0-9]+)\s+[HML]\s*\/\s*(-?[0-9]+\.[0-9]+)\s+[HML]$/);
  if (!match) throw new Error(`Unparsed correlation: ${text}`);
  return { spy: Number(match[1]), qqq: Number(match[2]) };
}

function reportUnverified(note: string): boolean {
  const text = note.toLowerCase();
  return ["unverified", "could not be verified", "could not be extracted", "rating omitted", "qualitative"].some((phrase) =>
    text.includes(phrase),
  );
}

type AppendixNote = { rating: string; note: string; sourceUrl: string; cik: number | null; reportUnverified: boolean };

function parseAppendix(lines: string[]): Map<string, AppendixNote> {
  const out = new Map<string, AppendixNote>();
  let started = false;
  for (const line of lines) {
    if (line.startsWith("Appendix:")) {
      started = true;
      continue;
    }
    if (!started || !line.trim()) continue;
    const match = line.trim().match(/^(High|Medium|Low|Beneficiary|n\/a)\s+(.+?)\s+\(([A-Z0-9.-]+)\)\.\s+(.*)$/);
    if (!match) throw new Error(`Unparsed appendix line: ${line.slice(0, 160)}`);
    const rest = match[4]!;
    const urlMatch = rest.match(/(https:\/\/\S+)\s*$/);
    if (!urlMatch) throw new Error(`Appendix row has no URL: ${match[3]}`);
    const sourceUrl = urlMatch[1]!;
    const note = rest.slice(0, urlMatch.index).trim();
    const cikMatch = sourceUrl.match(/\/edgar\/data\/(\d+)\//);
    out.set(match[3]!, {
      rating: match[1]!,
      note,
      sourceUrl,
      cik: cikMatch ? Number(cikMatch[1]) : null,
      reportUnverified: reportUnverified(note),
    });
  }
  return out;
}

type Draft = {
  rank: number;
  name: string;
  ticker: string;
  marketCapUsd: number;
  marketCapText: string;
  sector: string | null;
  blurb: string;
  corrSpy: number;
  corrQqq: number;
  war: string;
};

function takeCompany(lines: string[], index: number, withSector: boolean): { row: Draft; next: number } {
  const need = withSector ? 8 : 7;
  const chunk = lines.slice(index, index + need);
  if (chunk.length < need) throw new Error(`Short company block at line ${index}`);
  const ticker = chunk[2]!.trim();
  if (!/^[A-Z][A-Z0-9.-]*$/.test(ticker)) throw new Error(`Bad ticker ${ticker}`);
  const corr = parseCorr(chunk[withSector ? 6 : 5]!);
  const war = chunk[withSector ? 7 : 6]!.trim();
  if (!["High", "Medium", "Low", "Beneficiary", "n/a"].includes(war)) throw new Error(`Bad war rating ${war} for ${ticker}`);
  return {
    row: {
      rank: Number(chunk[0]!.trim()),
      name: chunk[1]!.trim(),
      ticker,
      marketCapText: chunk[3]!.trim(),
      marketCapUsd: parseCap(chunk[3]!.trim()),
      sector: withSector ? chunk[4]!.trim() : null,
      blurb: chunk[withSector ? 5 : 4]!.trim(),
      corrSpy: corr.spy,
      corrQqq: corr.qqq,
      war,
    },
    next: index + need,
  };
}

function beforeAppendix(lines: string[]): string[] {
  const out: string[] = [];
  for (const line of lines) {
    if (line.startsWith("Appendix:")) break;
    out.push(line);
  }
  return out;
}

function findStart(lines: string[]): number {
  for (let i = 0; i < lines.length; i++) {
    if (lines[i]?.trim() === "1" && /^[A-Z][A-Z0-9.-]*$/.test(lines[i + 2]?.trim() ?? "")) return i;
  }
  throw new Error("Could not find the first ranked company.");
}

/**
 * Parse the paragraph text extracted from the two docx reports.
 * Throws if a cell cannot be cited as printed. Does not fill missing ratios.
 */
export function parseReportTexts(top50Text: string, top3Text: string): ReportCompany[] {
  const top50Lines = top50Text.split(/\r?\n/);
  const top3Lines = top3Text.split(/\r?\n/);
  const app50 = parseAppendix(top50Lines);
  const app3 = parseAppendix(top3Lines);
  const body50 = beforeAppendix(top50Lines);
  const body3 = beforeAppendix(top3Lines);
  const preamble = body50.slice(0, findStart(body50)).join("\n");
  const shareClasses = preamble.includes("Alphabet and Berkshire counted once");
  const spacexShort = preamble.includes("106 days from Jun 15, 2026");

  type Acc = ReportCompany & { _order: number };
  const byTicker = new Map<string, Acc>();
  let order = 0;

  const upsert = (row: Draft, source: string, sector: string | null) => {
    const resolvedSector = sector ?? row.sector;
    if (!resolvedSector) throw new Error(`No sector for ${row.ticker}`);
    let current = byTicker.get(row.ticker);
    if (!current) {
      current = {
        _order: order++,
        ticker: row.ticker,
        name: row.name,
        sector: resolvedSector,
        blurb: row.blurb,
        marketCapUsd: row.marketCapUsd,
        marketCapText: row.marketCapText,
        corrSpy: row.corrSpy,
        corrQqq: row.corrQqq,
        corrWindow: "1y",
        corrShortHistory: false,
        corrHistoryNote: null,
        warExposure: row.war,
        warSourceUrl: "",
        warNote: "",
        warReportUnverified: false,
        cik: null,
        rankTop50: null,
        sectorRank: null,
        sources: [],
        shareClassesCombined: false,
      };
      byTicker.set(row.ticker, current);
    }
    if (current.name !== row.name || current.blurb !== row.blurb || current.marketCapUsd !== row.marketCapUsd) {
      throw new Error(`Report rows disagree for ${row.ticker}`);
    }
    if (current.corrSpy !== row.corrSpy || current.corrQqq !== row.corrQqq || current.warExposure !== row.war) {
      throw new Error(`Report rows disagree for ${row.ticker}`);
    }
    if (current.sector !== resolvedSector) throw new Error(`Sector disagree for ${row.ticker}`);
    if (!current.sources.includes(source)) current.sources.push(source);
    if (source === TOP50_SOURCE) current.rankTop50 = row.rank;
    if (source === TOP3_SOURCE) current.sectorRank = row.rank;
  };

  let i = findStart(body50);
  while (i < body50.length) {
    if (!body50[i]?.trim()) {
      i += 1;
      continue;
    }
    const taken = takeCompany(body50, i, true);
    upsert(taken.row, TOP50_SOURCE, null);
    i = taken.next;
  }

  let currentSector: string | null = null;
  i = 0;
  while (i < body3.length) {
    const line = body3[i]?.trim() ?? "";
    if (GICS.has(line)) {
      currentSector = line;
      i += 1;
      continue;
    }
    if (currentSector == null || HEADER.has(line) || line === "") {
      i += 1;
      continue;
    }
    if (/^\d+$/.test(line)) {
      const taken = takeCompany(body3, i, false);
      upsert(taken.row, TOP3_SOURCE, currentSector);
      i = taken.next;
      continue;
    }
    throw new Error(`Unexpected top-3 line: ${line}`);
  }

  const companies: ReportCompany[] = [];
  for (const row of [...byTicker.values()].sort((a, b) => a._order - b._order)) {
    const notes = [app50.get(row.ticker), app3.get(row.ticker)].filter((note): note is AppendixNote => note != null);
    if (notes.length === 0) throw new Error(`No appendix note for ${row.ticker}`);
    for (const note of notes) {
      if (note.rating !== row.warExposure) throw new Error(`War rating disagree for ${row.ticker}`);
    }
    const primary = app50.get(row.ticker) ?? notes[0]!;
    row.warNote = primary.note;
    row.warSourceUrl = primary.sourceUrl;
    row.cik = primary.cik;
    row.warReportUnverified = notes.some((note) => note.reportUnverified);
    row.corrShortHistory = row.ticker === "SPCX" && spacexShort;
    row.corrHistoryNote = row.corrShortHistory ? "106 trading days from Jun 15, 2026." : null;
    row.shareClassesCombined = shareClasses && (row.ticker === "GOOGL" || row.ticker === "BRK-B");
    companies.push({
      ticker: row.ticker,
      name: row.name,
      sector: row.sector,
      blurb: row.blurb,
      marketCapUsd: row.marketCapUsd,
      marketCapText: row.marketCapText,
      corrSpy: row.corrSpy,
      corrQqq: row.corrQqq,
      corrWindow: row.corrWindow,
      corrShortHistory: row.corrShortHistory,
      corrHistoryNote: row.corrHistoryNote,
      warExposure: row.warExposure,
      warSourceUrl: row.warSourceUrl,
      warNote: row.warNote,
      warReportUnverified: row.warReportUnverified,
      cik: row.cik,
      rankTop50: row.rankTop50,
      sectorRank: row.sectorRank,
      sources: row.sources,
      shareClassesCombined: row.shareClassesCombined,
    });
  }

  const ranked = companies.filter((row) => row.rankTop50 != null).sort((a, b) => a.rankTop50! - b.rankTop50!);
  const rest = companies.filter((row) => row.rankTop50 == null);
  return [...ranked, ...rest];
}
