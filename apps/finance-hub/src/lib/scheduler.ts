import { scheduleColdStartupDataPullOnce } from "@/lib/coldStartupDataPull";
import { logError, logLine } from "@/lib/log";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import { runSchwabRefreshSchedulerTick } from "@/lib/schwab/refreshOrchestrator";
import { maybeSyncBookForwardSnapsOnSchedulerTick } from "@/lib/dividends/bookForwardSnapScheduler";
import { warmGlanceCache } from "@/lib/terminal/glanceCache";

type SchedulerState = {
  started: boolean;
  metaIntervalId: NodeJS.Timeout | null;
  lastSlowRunAt: number;
  lastAccountValueRunAt: number;
  lastTickAt: number;
};

declare global {
  var __fhScheduler: SchedulerState | undefined;
}

const META_MS = 60_000;
const SLOW_MS = 600_000;
/** RTH account_value_points sync between full slow bundles (portfolio glance). */
const ACCOUNT_VALUE_RTH_MS = 180_000;

function state(): SchedulerState {
  if (!globalThis.__fhScheduler) {
    globalThis.__fhScheduler = {
      started: false,
      metaIntervalId: null,
      lastSlowRunAt: 0,
      lastAccountValueRunAt: 0,
      lastTickAt: 0,
    };
  }
  return globalThis.__fhScheduler;
}

export function seedSchedulerAfterColdPull(): void {
  const s = state();
  const now = Date.now();
  s.lastSlowRunAt = now;
  s.lastAccountValueRunAt = now;
}

export function startSchedulerOnce() {
  const s = state();
  if (s.started) return;

  const phase = process.env.NEXT_PHASE ?? "";
  if (phase.toLowerCase().includes("build")) return;

  s.started = true;
  logLine("scheduler_start");
  scheduleColdStartupDataPullOnce();

  async function tick() {
    try {
      s.lastTickAt = Date.now();
      const { lastSlowRunAt, lastAccountValueRunAt } = await runSchwabRefreshSchedulerTick({
        lastSlowRunAt: s.lastSlowRunAt,
        lastAccountValueRunAt: s.lastAccountValueRunAt,
        slowIntervalMs: SLOW_MS,
        accountValueIntervalMs: ACCOUNT_VALUE_RTH_MS,
      });
      s.lastSlowRunAt = lastSlowRunAt;
      s.lastAccountValueRunAt = lastAccountValueRunAt;
    } catch (e) {
      logError("scheduler_schwab_refresh_tick_failed", e);
    }
    void maybeSyncBookForwardSnapsOnSchedulerTick().catch((e) =>
      logError("scheduler_book_forward_snap_failed", e),
    );
    // Keep the terminal quick-glance payload warm so page opens are a local cache read.
    void warmGlanceCache().catch((e) => logError("scheduler_glance_warm_failed", e));
  }

  const jitterMs = () => Math.floor(Math.random() * 5_000);
  setTimeout(() => void tick(), 10_000 + jitterMs());
  s.metaIntervalId = setInterval(() => void tick(), META_MS);
}

export function schedulerDebugState() {
  const s = state();
  return {
    started: s.started,
    lastSlowRunAt: s.lastSlowRunAt,
    lastAccountValueRunAt: s.lastAccountValueRunAt,
    lastTickAt: s.lastTickAt,
    rthOpen: isUsEquityRegularSessionOpen(new Date()),
  };
}
