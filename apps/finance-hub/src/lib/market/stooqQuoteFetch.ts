import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const MIN_GAP_MS = 350;
let lastFetchAt = 0;

export type StooqQuote = {
  symbol: string;
  close: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  date: string | null;
  time: string | null;
};

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function throttleStooq(): Promise<void> {
  const now = Date.now();
  const wait = MIN_GAP_MS - (now - lastFetchAt);
  if (wait > 0) await sleep(wait);
  lastFetchAt = Date.now();
}

function parseNum(v: string | undefined): number | null {
  if (v == null || v.trim() === "" || v.trim().toUpperCase() === "N/D") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function parseStooqCsv(text: string, requested: string): StooqQuote {
  const lines = text.trim().split(/\r?\n/);
  if (lines.length < 2) {
    return { symbol: requested, close: null, open: null, high: null, low: null, date: null, time: null };
  }
  const cols = lines[1]!.split(",");
  return {
    symbol: (cols[0] ?? requested).trim(),
    date: cols[1]?.trim() || null,
    time: cols[2]?.trim() || null,
    open: parseNum(cols[3]),
    high: parseNum(cols[4]),
    low: parseNum(cols[5]),
    close: parseNum(cols[6]),
  };
}

/** Latest OHLC from Stooq's free CSV endpoint (no API key). */
export async function fetchStooqQuote(stooqSymbol: string): Promise<StooqQuote | null> {
  const sym = stooqSymbol.trim().toLowerCase();
  if (!sym) return null;
  await throttleStooq();
  const url = `https://stooq.com/q/l/?s=${encodeURIComponent(sym)}&f=sd2t2ohlc&h&e=csv`;
  try {
    const { stdout } = await execFileAsync(
      "curl",
      ["-sS", "-H", "User-Agent: Mozilla/5.0", url],
      { maxBuffer: 64 * 1024 },
    );
    const parsed = parseStooqCsv(String(stdout ?? ""), sym);
    if (parsed.close == null) return null;
    return parsed;
  } catch {
    return null;
  }
}
