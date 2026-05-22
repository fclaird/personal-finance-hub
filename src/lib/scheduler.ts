import { scheduleColdStartupDataPullOnce } from "@/lib/coldStartupDataPull";
import { logError, logLine } from "@/lib/log";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import { runSchwabRefreshSchedulerTick } from "@/lib/schwab/refreshOrchestrator";

type SchedulerState = {
  started: boolean;
  metaIntervalId: NodeJS.Timeout | null;
  lastSlowRunAt: number;
  lastTickAt: number;
};

declare global {
  var __fhScheduler: SchedulerState | undefined;
}

const META_MS = 60_000;
const SLOW_MS = 600_000;

function state(): SchedulerState {
  if (!globalThis.__fhScheduler) {
    globalThis.__fhScheduler = {
      started: false,
      metaIntervalId: null,
      lastSlowRunAt: 0,
      lastTickAt: 0,
    };
  }
  return globalThis.__fhScheduler;
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
      const { lastSlowRunAt } = await runSchwabRefreshSchedulerTick({
        lastSlowRunAt: s.lastSlowRunAt,
        slowIntervalMs: SLOW_MS,
      });
      s.lastSlowRunAt = lastSlowRunAt;
    } catch (e) {
      logError("scheduler_schwab_refresh_tick_failed", e);
    }
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
    lastTickAt: s.lastTickAt,
    rthOpen: isUsEquityRegularSessionOpen(new Date()),
  };
}
