export const FHFA_MASTER_CSV_URL = "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv";

export type ParsedHpi = {
  seriesId: string;
  period: string;
  index: number;
};

export function hpiSeriesId(placeId: string): string {
  return `fhfa-msa-at-${placeId}`;
}

export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else {
          inQuotes = false;
        }
      } else {
        cur += ch;
      }
    } else if (ch === '"') {
      inQuotes = true;
    } else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur);
  return out;
}

/** Quarterly all-transactions MSA rows for the requested place ids. Quarter maps to its ending month. */
export function parseFhfaMasterCsv(csv: string, placeIds: readonly string[]): ParsedHpi[] {
  const wanted = new Set(placeIds.map((id) => id.trim()));
  const lines = csv.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0) return [];
  const header = parseCsvLine(lines[0]!.replace(/^\uFEFF/, ""));
  const col = (name: string) => header.indexOf(name);
  const flavor = col("hpi_flavor");
  const frequency = col("frequency");
  const level = col("level");
  const place = col("place_id");
  const yearCol = col("yr");
  const periodCol = col("period");
  const indexCol = col("index_nsa");
  if ([flavor, frequency, level, place, yearCol, periodCol, indexCol].some((index) => index < 0)) {
    throw new Error("FHFA HPI CSV is missing expected columns");
  }
  const out: ParsedHpi[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]!);
    if (cells[flavor] !== "all-transactions" || cells[frequency] !== "quarterly" || cells[level] !== "MSA") continue;
    const placeId = (cells[place] ?? "").trim();
    if (!wanted.has(placeId)) continue;
    const year = Number(cells[yearCol]);
    const quarter = Number(cells[periodCol]);
    const index = Number(cells[indexCol]);
    if (!Number.isFinite(year) || quarter < 1 || quarter > 4 || !(index > 0)) continue;
    const month = String(quarter * 3).padStart(2, "0");
    out.push({ seriesId: hpiSeriesId(placeId), period: `${year}-${month}`, index });
  }
  return out;
}

export async function fetchFhfaMasterCsv(fetchImpl: typeof fetch = fetch): Promise<string> {
  const response = await fetchImpl(FHFA_MASTER_CSV_URL, {
    headers: { Accept: "text/csv", "User-Agent": "finance-hub (local real-estate index)" },
  });
  if (!response.ok) throw new Error(`FHFA HPI download failed (${response.status})`);
  return response.text();
}
