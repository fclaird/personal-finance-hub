import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { logError } from "@/lib/log";
import { yahooChartSymbol } from "@/lib/market/yahooChartFetch";

const execFileAsync = promisify(execFile);
const UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36";

type QuoteSummaryResult = {
  assetProfile?: {
    longBusinessSummary?: string;
    industry?: string;
    sector?: string;
  };
};

let crumbSession: { crumb: string; jarPath: string; loadedAt: number } | null = null;
const CRUMB_TTL_MS = 25 * 60 * 1000;

async function curl(args: string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync("curl", args, { maxBuffer: 8 * 1024 * 1024 });
    const text = String(stdout ?? "").trim();
    if (!text || text.startsWith("Too Many")) return null;
    return text;
  } catch {
    return null;
  }
}

async function getYahooCrumbSession(): Promise<{ crumb: string; jarPath: string } | null> {
  if (crumbSession && Date.now() - crumbSession.loadedAt < CRUMB_TTL_MS) {
    return { crumb: crumbSession.crumb, jarPath: crumbSession.jarPath };
  }

  const jarPath = join(tmpdir(), `yahoo-crumb-${randomUUID()}.txt`);
  await curl(["-sS", "-c", jarPath, "-b", jarPath, "-A", UA, "-o", "/dev/null", "https://finance.yahoo.com/quote/SPY"]);
  const crumb = await curl(["-sS", "-b", jarPath, "-A", UA, "https://query1.finance.yahoo.com/v1/test/getcrumb"]);
  if (!crumb || crumb.includes("<")) return null;

  crumbSession = { crumb, jarPath, loadedAt: Date.now() };
  return { crumb, jarPath };
}

function parseAssetProfile(json: Record<string, unknown>): QuoteSummaryResult["assetProfile"] | null {
  const qs = json.quoteSummary as { result?: QuoteSummaryResult[] } | undefined;
  return qs?.result?.[0]?.assetProfile ?? null;
}

/**
 * Yahoo Finance asset profile — longBusinessSummary (requires crumb + cookies).
 */
export async function fetchYahooLongBusinessSummary(symbol: string): Promise<{
  summary: string;
  sector: string | null;
  industry: string | null;
  profileUrl: string;
} | null> {
  const sym = yahooChartSymbol(symbol);
  if (!sym) return null;

  const profileUrl = `https://finance.yahoo.com/quote/${encodeURIComponent(sym)}/profile/`;

  try {
    const session = await getYahooCrumbSession();
    if (!session) return null;

    const url = `https://query1.finance.yahoo.com/v10/finance/quoteSummary/${encodeURIComponent(sym)}?modules=assetProfile&crumb=${encodeURIComponent(session.crumb)}`;
    const text = await curl(["-sS", "-b", session.jarPath, "-A", UA, url]);
    if (!text) return null;

    const json = JSON.parse(text) as Record<string, unknown>;
    const profile = parseAssetProfile(json);
    const summary = (profile?.longBusinessSummary ?? "").replace(/\s+/g, " ").trim();
    if (summary.length < 40) return null;

    return {
      summary,
      sector: profile?.sector?.trim() || null,
      industry: profile?.industry?.trim() || null,
      profileUrl,
    };
  } catch (e) {
    logError("yahoo_asset_profile", e);
    return null;
  }
}
