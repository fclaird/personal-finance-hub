import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { bridgeLog, yieldEventLoop } from "@/lib/eventLoopDiag";
import { prepareCached } from "@/lib/dbPragmas";
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

type CacheRow = { payload_json: string; series_json: string | null; updated_at: string };

type SeriesSlot = { series: UsMarketGlanceItem["series"]; extendedSeries: UsMarketGlanceItem["extendedSeries"] | null };

type SeriesBundle = {
  items: SeriesSlot[];
  alternateGlanceItems: SeriesSlot[];
  futuresGlanceItems: SeriesSlot[];
};

function seriesSlot(item: UsMarketGlanceItem): SeriesSlot {
  return { series: item.series ?? [], extendedSeries: item.extendedSeries ?? null };
}

function shellItem(item: UsMarketGlanceItem): UsMarketGlanceItem {
  const { extendedSeries: _extended, ...rest } = item;
  return { ...rest, series: [] };
}

/** Series live in their own row so a last-price tick does not rewrite the charts. */
export function splitGlancePayload(payload: GlancePayload): { shell: GlancePayload; series: SeriesBundle } {
  return {
    shell: {
      ...payload,
      items: payload.items.map(shellItem),
      alternateGlanceItems: payload.alternateGlanceItems.map(shellItem),
      futuresGlanceItems: payload.futuresGlanceItems.map(shellItem),
    },
    series: {
      items: payload.items.map(seriesSlot),
      alternateGlanceItems: payload.alternateGlanceItems.map(seriesSlot),
      futuresGlanceItems: payload.futuresGlanceItems.map(seriesSlot),
    },
  };
}

function graftItems(items: UsMarketGlanceItem[], slots: SeriesSlot[] | undefined): UsMarketGlanceItem[] {
  if (!slots || slots.length === 0) return items;
  return items.map((item, i) => {
    const slot = slots[i];
    if (!slot) return item;
    const next: UsMarketGlanceItem = { ...item, series: slot.series ?? item.series };
    if (slot.extendedSeries && slot.extendedSeries.length > 0) next.extendedSeries = slot.extendedSeries;
    return next;
  });
}

export function mergeGlancePayload(shell: GlancePayload, series: SeriesBundle | null): GlancePayload {
  if (!series) return shell;
  return {
    ...shell,
    items: graftItems(shell.items, series.items),
    alternateGlanceItems: graftItems(shell.alternateGlanceItems, series.alternateGlanceItems),
    futuresGlanceItems: graftItems(shell.futuresGlanceItems, series.futuresGlanceItems),
  };
}

function readCacheRow(db: Database.Database, cacheKey: string, sessionYmd: string): CacheRow | null {
  const row = db
    .prepare(
      `
      SELECT c.payload_json, c.updated_at, s.series_json
      FROM glance_cache c
      LEFT JOIN glance_cache_series s
        ON s.cache_key = c.cache_key AND s.session_ymd = c.session_ymd
      WHERE c.cache_key = ? AND c.session_ymd = ?
    `,
    )
    .get(cacheKey, sessionYmd) as CacheRow | undefined;
  return row ?? null;
}

/** Ignore updatedAt so a warm tick does not rewrite an unchanged glance JSON. */
export function glancePayloadChanged(prevJson: string | null, next: GlancePayload): boolean {
  if (!prevJson) return true;
  try {
    const prev = JSON.parse(prevJson) as GlancePayload;
    const { updatedAt: _prevAt, ...prevBody } = prev;
    const { updatedAt: _nextAt, ...nextBody } = next;
    return JSON.stringify(prevBody) !== JSON.stringify(nextBody);
  } catch {
    return true;
  }
}

export type GlancePersistResult = {
  wroteShell: boolean;
  wroteSeries: boolean;
  shellBytes: number;
  seriesBytes: number;
};

/**
 * Store a glance payload. The shell row holds prices and labels. The series
 * row holds the chart points and is skipped when those points did not change.
 */
export function persistGlancePayload(
  db: Database.Database,
  cacheKey: string,
  sessionYmd: string,
  payload: GlancePayload,
): GlancePersistResult {
  const { shell, series } = splitGlancePayload(payload);
  const stringifyStarted = Date.now();
  const shellJson = JSON.stringify(shell);
  const seriesJson = JSON.stringify(series);
  const stringifyMs = Date.now() - stringifyStarted;
  if (stringifyMs >= 50) {
    bridgeLog(
      `glance_json ms=${stringifyMs} shell_bytes=${shellJson.length} series_bytes=${seriesJson.length} key=${cacheKey}`,
    );
  }
  const prev = readCacheRow(db, cacheKey, sessionYmd);
  const wroteSeries = !prev || prev.series_json !== seriesJson;
  const wroteShell = !prev || glancePayloadChanged(prev.payload_json, shell);
  if (wroteShell || wroteSeries) {
    const tx = db.transaction(() => {
      if (wroteSeries) {
        prepareCached(
          db,
          "glance_series_upsert",
          `
          INSERT INTO glance_cache_series (cache_key, session_ymd, series_json)
          VALUES (@cache_key, @session_ymd, @series_json)
          ON CONFLICT(cache_key, session_ymd) DO UPDATE SET
            series_json = excluded.series_json
            WHERE glance_cache_series.series_json IS NOT excluded.series_json
        `,
        ).run({ cache_key: cacheKey, session_ymd: sessionYmd, series_json: seriesJson });
      }
      if (wroteShell || wroteSeries) {
        prepareCached(
          db,
          "glance_shell_upsert",
          `
          INSERT INTO glance_cache (cache_key, session_ymd, payload_json, updated_at)
          VALUES (@cache_key, @session_ymd, @payload_json, @updated_at)
          ON CONFLICT(cache_key, session_ymd) DO UPDATE SET
            payload_json = excluded.payload_json,
            updated_at = excluded.updated_at
            WHERE glance_cache.payload_json IS NOT excluded.payload_json
               OR glance_cache.updated_at IS NOT excluded.updated_at
        `,
        ).run({
          cache_key: cacheKey,
          session_ymd: sessionYmd,
          payload_json: shellJson,
          updated_at: payload.updatedAt,
        });
      }
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
      db.prepare(
        `
        DELETE FROM glance_cache_series
        WHERE cache_key = @cache_key
          AND session_ymd NOT IN (
            SELECT session_ymd FROM glance_cache WHERE cache_key = @cache_key
          )
      `,
      ).run({ cache_key: cacheKey });
    });
    tx();
  }
  return { wroteShell, wroteSeries, shellBytes: shellJson.length, seriesBytes: seriesJson.length };
}

function writeCacheRow(db: Database.Database, cacheKey: string, sessionYmd: string, payload: GlancePayload): void {
  persistGlancePayload(db, cacheKey, sessionYmd, payload);
}

function parsePayload(row: CacheRow): GlancePayload | null {
  try {
    const shell = JSON.parse(row.payload_json) as GlancePayload;
    if (!row.series_json) return shell;
    return mergeGlancePayload(shell, JSON.parse(row.series_json) as SeriesBundle);
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
    await yieldEventLoop();
    try {
      writeCacheRow(getDb(), glanceCacheKey(flavor), sessionYmd, payload);
      await yieldEventLoop();
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
      await yieldEventLoop();
    } catch (e) {
      logError("glance_cache_warm", e);
    }
  }
}
