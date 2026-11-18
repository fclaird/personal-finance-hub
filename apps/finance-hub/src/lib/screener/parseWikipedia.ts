export type Sp500Constituent = {
  ticker: string;
  wikiSymbol: string;
  name: string | null;
  gicsSector: string | null;
  gicsSubIndustry: string | null;
  cik: number | null;
};

function cleanWiki(text: string): string {
  return text
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/\[\[(?:[^|\]]+\|)?([^\]]+)\]\]/g, "$1")
    .replace(/\{\{[^}]+\}\}/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Parse the constituent wikitable. Cboe uses `{{BZX link|CBOE}}`. Dots become hyphens on `ticker`. */
export function parseSp500Wikitext(wikitext: string): Sp500Constituent[] {
  const start = wikitext.indexOf('id="constituents"');
  const slice = start >= 0 ? wikitext.slice(start) : wikitext;
  const end = slice.indexOf("\n==See also==");
  const body = end >= 0 ? slice.slice(0, end) : slice;
  const rows: Sp500Constituent[] = [];
  for (const row of body.split("\n|-")) {
    const symbolMatch = row.match(/\{\{(?:NyseSymbol|NasdaqSymbol|BZX link)\|([^}]+)\}\}/);
    if (!symbolMatch) continue;
    const wikiSymbol = symbolMatch[1]!.trim();
    const parts = row
      .split("||")
      .map((part) => part.trim())
      .filter((part) => part.length > 0);
    const rest = parts.slice(1);
    const cikMatch = row.match(/\|\|\s*(0\d{4,9})/);
    rows.push({
      ticker: wikiSymbol.replace(/\./g, "-"),
      wikiSymbol,
      name: rest[0] ? cleanWiki(rest[0]) : null,
      gicsSector: rest[1] ? cleanWiki(rest[1]) : null,
      gicsSubIndustry: rest[2] ? cleanWiki(rest[2]) : null,
      cik: cikMatch ? Number(cikMatch[1]) : null,
    });
  }
  return rows;
}
