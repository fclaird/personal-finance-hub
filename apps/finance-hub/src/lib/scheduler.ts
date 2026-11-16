import { scheduleColdStartupDataPullOnce } from "@/lib/coldStartupDataPull";
import { checkpointWalPassive } from "@/lib/dbPragmas";
import { getDb } from "@/lib/db";
import { logError, logLine } from "@/lib/log";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import { runSchwabRefreshSchedulerTick } from "@/lib/schwab/refreshOrchestrator";
import { maybeSyncBookForwardSnapsOnSchedulerTick } from "@/lib/dividends/bookForwardSnapScheduler";
import { maybeSyncRealEstateMonthly } from "@/lib/realEstate/monthly";
import { warmGlanceCache } from "@/lib/terminal/glanceCache";

type SchedulerState = {
  started: boolean;
  metaIntervalId: NodeJS.Timeout | null;
  lastSlowRunAt: number;
  lastAccountValueRunAt: number;
  lastTickAt: number;
  lastCheckpointAt: number;
  inFlight: boolean;
  overlapSkips: number;
  ticksStarted: number;
  stopGuard: (() => void) | null;
};

declare global {
  var __fhScheduler: SchedulerState | undefined;
}

const META_MS = 60_000;
const SLOW_MS = 600_000;
/** RTH account_value_points sync between full slow bundles (portfolio glance). */
const ACCOUNT_VALUE_RTH_MS = 180_000;
/** Copying the WAL into the main database every minute rewrote the same pages. */
export const WAL_CHECKPOINT_INTERVAL_MS = 10 * 60_000;

export function shouldCheckpointWal(now: number, lastAt: number, intervalMs = WAL_CHECKPOINT_INTERVAL_MS): boolean {
  return now - lastAt >= intervalMs;
}

export type SchedulerTimers = {
  setTimeout: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearTimeout: (id: NodeJS.Timeout) => void;
  setInterval: (fn: () => void, ms: number) => NodeJS.Timeout;
  clearInterval: (id: NodeJS.Timeout) => void;
};

const defaultTimers: SchedulerTimers = {
  setTimeout: (fn, ms) => setTimeout(fn, ms),
  clearTimeout: (id) => clearTimeout(id),
  setInterval: (fn, ms) => setInterval(fn, ms),
  clearInterval: (id) => clearInterval(id),
};

function state(): SchedulerState {
  if (!globalThis.__fhScheduler) {
    globalThis.__fhScheduler = {
      started: false,
      metaIntervalId: null,
      lastSlowRunAt: 0,
      lastAccountValueRunAt: 0,
      lastTickAt: 0,
      lastCheckpointAt: 0,
      inFlight: false,
      overlapSkips: 0,
      ticksStarted: 0,
      stopGuard: null,
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

export type SchedulerStartOptions = {
  /** Test seam. Production omits this and runs the Schwab / glance tick. */
  tick?: () => Promise<void>;
  timers?: SchedulerTimers;
  intervalMs?: number;
  initialDelayMs?: number;
};

/**
 * One timer callback at a time.
 * A tick that outlives the interval used to start another Schwab/Yahoo/curl
 * fan-out every minute. Those calls had no deadline, so the leftovers held
 * sockets and child processes until the dev server stopped accepting connections.
 */
export function createHubScheduler(
  run: () => Promise<void>,
  opts: {
    intervalMs: number;
    initialDelayMs: number;
    timers?: SchedulerTimers;
    stats: { inFlight: boolean; overlapSkips: number; ticksStarted: number };
  },
): { stop: () => void } {
  const timers = opts.timers ?? defaultTimers;
  const stats = opts.stats;
  let stopped = false;
  let initialId: NodeJS.Timeout | null = null;
  let intervalId: NodeJS.Timeout | null = null;

  const fire = () => {
    if (stopped) return;
    if (stats.inFlight) {
      stats.overlapSkips += 1;
      if (stats.overlapSkips === 1) logLine("scheduler_tick_skipped_overlap");
      return;
    }
    stats.inFlight = true;
    stats.ticksStarted += 1;
    void run()
      .catch((e) => logError("scheduler_tick_failed", e))
      .finally(() => {
        stats.inFlight = false;
      });
  };

  initialId = timers.setTimeout(fire, opts.initialDelayMs);
  intervalId = timers.setInterval(fire, opts.intervalMs);

  return {
    stop() {
      stopped = true;
      if (initialId != null) timers.clearTimeout(initialId);
      if (intervalId != null) timers.clearInterval(intervalId);
      initialId = null;
      intervalId = null;
    },
  };
}

async function productionTick(s: SchedulerState): Promise<void> {
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
  // Await these so a slow glance or dividend snap cannot run beside the next tick.
  await maybeSyncBookForwardSnapsOnSchedulerTick().catch((e) =>
    logError("scheduler_book_forward_snap_failed", e),
  );
  await maybeSyncRealEstateMonthly().catch((e) => logError("scheduler_real_estate_failed", e));
  await warmGlanceCache().catch((e) => logError("scheduler_glance_warm_failed", e));
  const now = Date.now();
  if (shouldCheckpointWal(now, s.lastCheckpointAt ?? 0)) {
    try {
      checkpointWalPassive(getDb());
      s.lastCheckpointAt = now;
    } catch (e) {
      logError("scheduler_wal_checkpoint_failed", e);
    }
  }
}

export function startSchedulerOnce(opts?: SchedulerStartOptions): { stop: () => void } {
  const s = state();
  if (s.started) return { stop: () => s.stopGuard?.() };

  const phase = process.env.NEXT_PHASE ?? "";
  if (phase.toLowerCase().includes("build")) return { stop: () => {} };

  s.started = true;
  logLine("scheduler_start");
  if (!opts?.tick) scheduleColdStartupDataPullOnce();

  const jitterMs = () => Math.floor(Math.random() * 5_000);
  const guard = createHubScheduler(opts?.tick ?? (() => productionTick(s)), {
    intervalMs: opts?.intervalMs ?? META_MS,
    initialDelayMs: opts?.initialDelayMs ?? 10_000 + jitterMs(),
    timers: opts?.timers,
    stats: s,
  });
  s.stopGuard = guard.stop;
  return guard;
}

export function resetSchedulerForTests(): void {
  const s = globalThis.__fhScheduler;
  s?.stopGuard?.();
  globalThis.__fhScheduler = undefined;
}

export function schedulerDebugState() {
  const s = state();
  return {
    started: s.started,
    inFlight: s.inFlight,
    overlapSkips: s.overlapSkips,
    ticksStarted: s.ticksStarted,
    lastSlowRunAt: s.lastSlowRunAt,
    lastAccountValueRunAt: s.lastAccountValueRunAt,
    lastTickAt: s.lastTickAt,
    rthOpen: isUsEquityRegularSessionOpen(new Date()),
  };
}
