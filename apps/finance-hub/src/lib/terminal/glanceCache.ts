import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { FLAVOR_IDS, type FlavorId } from "@/lib/flavor";
import { logError } from "@/lib/log";
import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
import { fetchGlanceAlternateCards } from "@/lib/market/fetchGlanceAlternateCards";
import { glanceChartContext } from "@/lib/market/glanceExtendedHours";
import { fetchRegionalGlanceItems } from "@/lib/market/regionalGlanceItems";
import { formatGlanceSessionLabel, glanceSessionUsesPriorDay, glanceSessionYmd } from "@/lib/market/glanceSession";
import { fetchCanonicalGlanceGrid } from "@/lib/market/glanceSessionGrid";
import { isUsEquityRegularSessionOpen, usEquitySessionStatus } from "@/lib/market/usEquitySession";
import { ensureUsMarketIndexBenchmarks, fetchUsMarketIndexCards } from "@/lib/market/usMarketIndices";
import { fetchPortfolioGlanceCard } from "@/lib/terminal/portfolioGlance";

export function glanceCacheKey(flavor: FlavorId): string {
  return `us-markets:${flavor}`;
}

/** Serve cached payloads younger than this without revalidating. */
const FRESH_MS_OPEN = 30_000;
const FRESH_MS_CLOSED = 5 * 60_000;

export type GlancePayload = {
  ok: true;
  session: {
    headline: string;
    detail: string;
    isOpen: boolean;
    sessionYmd: string;
    chartYmd: string;
    sessionLabel: string;
    showingPriorSession: boolean;
  };
  items: UsMarketGlanceItem[];
  alternateGlanceItems: UsMarketGlanceItem[];
  futuresGlanceItems: UsMarketGlanceItem[];
  updatedAt: string;
};

/** Assemble the full quick-glance payload from upstream sources (the expensive fan-out). */
export async function buildGlancePayload(now: Date = new Date(), flavor: FlavorId = "main"): Promise<GlancePayload> {
  await ensureUsMarketIndexBenchmarks();
  const sessionYmd = glanceSessionYmd(now);
  const grid = await fetchCanonicalGlanceGrid(sessionYmd, now);
  const [portfolio, indexItems, futuresGlanceItems, alternateGlanceItems] = await Promise.all([
    fetchPortfolioGlanceCard(now, grid, flavor),
    fetchUsMarketIndexCards(now, grid),
    fetchRegionalGlanceItems(now),
    fetchGlanceAlternateCards(now, grid),
  ]);
  const russell2000 = alternateGlanceItems.find((item) => item.id === "russell2000") ?? null;
  const session = usEquitySessionStatus(now);
  const chartCtx = glanceChartContext(now);
  const sessionLabel = formatGlanceSessionLabel(sessionYmd);
  return {
    ok: true,
    session: {
      ...session,
      sessionYmd,
      chartYmd: chartCtx.chartYmd,
      sessionLabel,
      showingPriorSession: glanceSessionUsesPriorDay(now),
    },
    items: [portfolio, ...indexItems],
    alternateGlanceItems,
    futuresGlanceItems: russell2000 ? [...futuresGlanceItems, russell2000] : futuresGlanceItems,
    updatedAt: now.toISOString(),
  };
}

type CacheRow = { payload_json: string; updated_at: string };

function readCacheRow(db: Database.Database, cacheKey: string, sessionYmd: string): CacheRow | null {
  const row = db
    .prepare(`SELECT payload_json, updated_at FROM glance_cache WHERE cache_key = ? AND session_ymd = ?`)
    .get(cacheKey, sessionYmd) as CacheRow | undefined;
  return row ?? null;
}

function writeCacheRow(db: Database.Database, cacheKey: string, sessionYmd: string, payload: GlancePayload): void {
  db.prepare(
    `
    INSERT INTO glance_cache (cache_key, session_ymd, payload_json, updated_at)
    VALUES (@cache_key, @session_ymd, @payload_json, @updated_at)
    ON CONFLICT(cache_key, session_ymd) DO UPDATE SET
      payload_json = excluded.payload_json,
      updated_at = excluded.updated_at
  `,
  ).run({
    cache_key: cacheKey,
    session_ymd: sessionYmd,
    payload_json: JSON.stringify(payload),
    updated_at: payload.updatedAt,
  });
  db.prepare(
    `
    DELETE FROM glance_cache
    WHERE cache_key = @cache_key
      AND session_ymd NOT IN (
        SELECT session_ymd FROM glance_cache WHERE cache_key = @cache_key
        ORDER BY session_ymd DESC LIMIT 2
      )
  `,
  ).run({ cache_key: cacheKey });
}

function parsePayload(row: CacheRow): GlancePayload | null {
  try {
    return JSON.parse(row.payload_json) as GlancePayload;
  } catch {
    return null;
  }
}

const inflight = new Map<string, Promise<GlancePayload>>();

function inflightKey(flavor: FlavorId, sessionYmd: string): string {
  return `${flavor}:${sessionYmd}`;
}

async function rebuildAndStore(now: Date, sessionYmd: string, flavor: FlavorId): Promise<GlancePayload> {
  const key = inflightKey(flavor, sessionYmd);
  const existing = inflight.get(key);
  if (existing) return existing;
  const p = (async () => {
    const payload = await buildGlancePayload(now, flavor);
    try {
      writeCacheRow(getDb(), glanceCacheKey(flavor), sessionYmd, payload);
    } catch (e) {
      logError("glance_cache_write", e);
    }
    return payload;
  })().finally(() => inflight.delete(key));
  inflight.set(key, p);
  return p;
}

export async function getGlancePayloadCached(now: Date = new Date(), flavor: FlavorId = "main"): Promise<GlancePayload> {
  const sessionYmd = glanceSessionYmd(now);
  const cacheKey = glanceCacheKey(flavor);
  const db = getDb();
  const row = readCacheRow(db, cacheKey, sessionYmd);
  const cached = row ? parsePayload(row) : null;

  if (!cached) {
    return rebuildAndStore(now, sessionYmd, flavor);
  }

  const ageMs = now.getTime() - new Date(row!.updated_at).getTime();
  const freshMs = isUsEquityRegularSessionOpen(now) ? FRESH_MS_OPEN : FRESH_MS_CLOSED;
  if (ageMs > freshMs) {
    void rebuildAndStore(now, sessionYmd, flavor).catch((e) => logError("glance_cache_revalidate", e));
  }
  return cached;
}

export async function warmGlanceCache(now: Date = new Date()): Promise<void> {
  for (const flavor of FLAVOR_IDS) {
    try {
      const sessionYmd = glanceSessionYmd(now);
      const row = readCacheRow(getDb(), glanceCacheKey(flavor), sessionYmd);
      const ageMs = row ? now.getTime() - new Date(row.updated_at).getTime() : Infinity;
      if (ageMs > FRESH_MS_OPEN) {
        await rebuildAndStore(now, sessionYmd, flavor);
      }
    } catch (e) {
      logError("glance_cache_warm", e);
    }
  }
}
