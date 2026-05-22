import { fetchFinnhubEarningsCalendar, fetchFinnhubLiquidityFromCandles, type FinnhubEarningsCalendarItem } from "@/lib/earnings/finnhub";
import { getEarningsSymbolUniverse } from "@/lib/earnings/universe";
import { eventId, upsertEarningsEvent, upsertMetrics } from "@/lib/earnings/store";

function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

function isoDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function dedupeCalendar(rows: FinnhubEarningsCalendarItem[]): FinnhubEarningsCalendarItem[] {
  const map = new Map<string, FinnhubEarningsCalendarItem>();
  for (const r of rows) {
    const sym = (r.symbol ?? "").trim().toUpperCase();
    const dt = (r.date ?? "").trim();
    if (!sym || !dt) continue;
    map.set(`${sym}|${dt}`, r);
  }
  return Array.from(map.values());
}

export type FinnhubSyncResult = {
  eventsUpserted: number;
  calendarRows: number;
  volumeFetches: number;
};

/**
 * Finnhub earnings calendar + 20d average dollar volume per symbol (liquidity vs typical names).
 * IV / 52w IV band: use Schwab enrichment when available.
 */
export async function syncEarningsFromFinnhub(options: {
  daysAhead: number;
  symbolUniverseLimit: number;
}): Promise<FinnhubSyncResult> {
  const end = new Date();
  const start = new Date(end.getTime() + 86400000);
  const endRange = new Date(end.getTime() + options.daysAhead * 86400000);

  const fromIso = isoDate(start);
  const toIso = isoDate(endRange);

  let calendar: FinnhubEarningsCalendarItem[] = [];

  try {
    calendar = await fetchFinnhubEarningsCalendar(fromIso, toIso);
  } catch {
    calendar = [];
  }

  if (calendar.length === 0) {
    const universe = getEarningsSymbolUniverse(options.symbolUniverseLimit);
    for (const sym of universe) {
      try {
        const part = await fetchFinnhubEarningsCalendar(fromIso, toIso, sym);
        calendar.push(...part);
      } catch {
        /* skip */
      }
      await sleep(120);
    }
  }

  const merged = dedupeCalendar(calendar);
  let eventsUpserted = 0;

  for (const row of merged) {
    const sym = (row.symbol ?? "").trim().toUpperCase();
    const dt = (row.date ?? "").trim();
    if (!sym || !dt) continue;

    upsertEarningsEvent({
      symbol: sym,
      earningsDate: dt,
      fiscalPeriodEnd: row.fiscalDateEnding ?? null,
      timeOfDay: row.time ?? null,
      source: "finnhub",
      rawJson: JSON.stringify(row),
    });
    eventsUpserted++;
  }

  const symToEventIds = new Map<string, Set<string>>();
  for (const row of merged) {
    const sym = (row.symbol ?? "").trim().toUpperCase();
    const dt = (row.date ?? "").trim();
    if (!sym || !dt) continue;
    const eid = eventId(sym, dt);
    const set = symToEventIds.get(sym) ?? new Set<string>();
    set.add(eid);
    symToEventIds.set(sym, set);
  }

  let volumeFetches = 0;
  for (const [sym, eidSet] of symToEventIds) {
    const eids = Array.from(eidSet);
    let liq: Awaited<ReturnType<typeof fetchFinnhubLiquidityFromCandles>> | null = null;
    try {
      liq = await fetchFinnhubLiquidityFromCandles(sym);
      volumeFetches++;
    } catch {
      liq = null;
    }

    for (const eid of eids) {
      if (liq && liq.avgDollarVolume20d != null && liq.avgDollarVolume20d > 0) {
        upsertMetrics({
          earningsEventId: eid,
          avgDollarVolume20d: liq.avgDollarVolume20d,
          metricsSource: "finnhub_candles",
        });
      } else {
        upsertMetrics({
          earningsEventId: eid,
          metricsSource: "finnhub_calendar_only",
        });
      }
    }
    await sleep(150);
  }

  return {
    eventsUpserted,
    calendarRows: merged.length,
    volumeFetches,
  };
}
