import { getDb } from "@/lib/db";
import { logError, logLine } from "@/lib/log";
import { isoDateUtc } from "@/lib/dividends/dates";
import {
  hasBookForwardSnapGaps,
  needsBookForwardSnapCapture,
  syncBookForwardSnaps,
} from "@/lib/dividends/bookForwardSnap";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";

declare global {
  var __fhBookForwardSnapLastDate: string | undefined;
}

/** Once per UTC calendar day (or when gaps exist), log dividend-book NAV for the live forward chart. */
export async function maybeSyncBookForwardSnapsOnSchedulerTick(now: Date = new Date()): Promise<void> {
  const today = isoDateUtc(now);
  const db = getDb();
  const needsToday = needsBookForwardSnapCapture(db, now);
  const hasGaps = hasBookForwardSnapGaps(db, now);
  const alreadyRanToday = globalThis.__fhBookForwardSnapLastDate === today;

  if (!needsToday && !hasGaps && alreadyRanToday) return;

  try {
    const rth = isUsEquityRegularSessionOpen(now);
    const result = await syncBookForwardSnaps(db, now, {
      fetchLiveQuotes: rth,
      backfill: hasGaps || needsToday,
    });
    globalThis.__fhBookForwardSnapLastDate = today;
    logLine(
      `book_forward_snap_sync ok=${result.ok} asOf=${result.asOf} backfilled=${result.backfilled}`,
    );
  } catch (e) {
    logError("book_forward_snap_scheduler_failed", e);
  }
}
