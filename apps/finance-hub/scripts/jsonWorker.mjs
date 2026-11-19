/**
 * Parse a Yahoo chart body off the request thread and return only the fields
 * the hub reads. The full chart JSON is multi-megabyte; parsing it on the
 * main thread stalls /api/health.
 */
import { parentPort } from "node:worker_threads";

function slimChart(parsed) {
  const chart = parsed?.chart;
  const result = Array.isArray(chart?.result) ? chart.result[0] : null;
  if (!result || result.meta == null) return null;
  const quote = result.indicators?.quote?.[0] ?? {};
  return {
    meta: result.meta,
    timestamp: Array.isArray(result.timestamp) ? result.timestamp : [],
    close: Array.isArray(quote.close) ? quote.close : [],
    events: result.events ?? null,
  };
}

function parseCsvLine(line) {
  const out = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (inQuotes) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"';
          i += 1;
        } else inQuotes = false;
      } else cur += ch;
    } else if (ch === '"') inQuotes = true;
    else if (ch === ",") {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out;
}

function parseFhfa(text, placeIds) {
  const wanted = new Set((placeIds ?? []).map((id) => String(id).trim()));
  const lines = text.split(/\r?\n/).filter((line) => line.trim().length > 0);
  if (lines.length === 0 || wanted.size === 0) return [];
  const header = parseCsvLine(lines[0].replace(/^\uFEFF/, ""));
  const col = (name) => header.indexOf(name);
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
  const out = [];
  for (let i = 1; i < lines.length; i++) {
    const cells = parseCsvLine(lines[i]);
    if (cells[flavor] !== "all-transactions" || cells[frequency] !== "quarterly" || cells[level] !== "MSA") continue;
    const placeId = (cells[place] ?? "").trim();
    if (!wanted.has(placeId)) continue;
    const year = Number(cells[yearCol]);
    const quarter = Number(cells[periodCol]);
    const index = Number(cells[indexCol]);
    if (!Number.isFinite(year) || quarter < 1 || quarter > 4 || !(index > 0)) continue;
    const month = String(quarter * 3).padStart(2, "0");
    out.push({ seriesId: `fhfa-msa-at-${placeId}`, period: `${year}-${month}`, index });
  }
  return out;
}

const FHFA_MASTER_CSV_URL = "https://www.fhfa.gov/hpi/download/monthly/hpi_master.csv";

async function fetchFhfa(placeIds) {
  const response = await fetch(FHFA_MASTER_CSV_URL, {
    headers: { Accept: "text/csv", "User-Agent": "finance-hub (local real-estate index)" },
    signal: AbortSignal.timeout(20_000),
  });
  if (!response.ok) throw new Error(`FHFA HPI download failed (${response.status})`);
  return parseFhfa(await response.text(), placeIds);
}

parentPort?.on("message", async (msg) => {
  const id = msg?.id;
  try {
    let value;
    if (msg.op === "fhfa-fetch") value = await fetchFhfa(msg.placeIds);
    else if (msg.op === "fhfa") value = parseFhfa(Buffer.from(msg.bytes).toString("utf8"), msg.placeIds);
    else value = slimChart(JSON.parse(Buffer.from(msg.bytes).toString("utf8")));
    parentPort.postMessage({ id, ok: true, value });
  } catch (err) {
    parentPort.postMessage({
      id,
      ok: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
});
