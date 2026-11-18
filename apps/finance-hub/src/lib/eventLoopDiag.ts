import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, type IntervalHistogram } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

/** Log a lag spike when the 10s p99 crosses this. */
export const EVENT_LOOP_LAG_P99_MS = 500;
const SAMPLE_MS = 10_000;
const VITALS_EVERY_SAMPLES = 6;

export type InflightJob = { name: string; startedAt: number };

export type WalCheckpointOffThreadResult = {
  busy: number;
  log: number;
  checkpointed: number;
};

type CheckpointWorkerMessage = WalCheckpointOffThreadResult & { ok?: boolean; error?: string };

const inflight = new Map<string, InflightJob>();
let monitorStarted = false;
let monitorTimer: NodeJS.Timeout | null = null;
let histogram: IntervalHistogram | null = null;
let checkpointInFlight: Promise<WalCheckpointOffThreadResult> | null = null;

export function eventLoopLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  if (env.FINANCE_HUB_EVENT_LOOP_LOG === "0") return false;
  if (env.FINANCE_HUB_BRIDGE_LOG) return true;
  if (env.FINANCE_HUB_EVENT_LOOP_LOG === "1") return true;
  return env.NODE_ENV === "production";
}

export function bridgeLogPath(env: NodeJS.ProcessEnv = process.env): string {
  if (env.FINANCE_HUB_BRIDGE_LOG) return env.FINANCE_HUB_BRIDGE_LOG;
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Logs", "finance-hub", "bridge.log");
  return path.join(os.homedir(), ".local", "share", "finance-hub", "logs", "bridge.log");
}

/** One line in bridge.log. appendFileSync so a kill during a stall still has the line. */
export function bridgeLog(message: string, env: NodeJS.ProcessEnv = process.env): void {
  if (!eventLoopLogEnabled(env)) return;
  const line = `[${new Date().toISOString()}] [event-loop] ${message}\n`;
  try {
    const file = bridgeLogPath(env);
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.appendFileSync(file, line);
  } catch {
    // The watchdog log is best-effort. A full disk must not take the server down.
  }
}

export function inflightJobs(): InflightJob[] {
  return [...inflight.values()];
}

export function formatInflight(jobs: InflightJob[], now = Date.now()): string {
  if (jobs.length === 0) return "none";
  return jobs
    .map((job) => `${job.name} start=${new Date(job.startedAt).toISOString()} age_ms=${now - job.startedAt}`)
    .join(",");
}

export function shouldLogEventLoopLag(p99Ms: number): boolean {
  return Number.isFinite(p99Ms) && p99Ms > EVENT_LOOP_LAG_P99_MS;
}

export function yieldEventLoop(): Promise<void> {
  return new Promise((resolve) => {
    setImmediate(resolve);
  });
}

/**
 * Record a scheduled job. Start and end both go to bridge.log so a lag line
 * can name whoever is still in flight.
 */
export async function runTracked<T>(name: string, fn: () => Promise<T> | T): Promise<T> {
  const startedAt = Date.now();
  const key = `${name}:${startedAt}:${inflight.size}`;
  inflight.set(key, { name, startedAt });
  bridgeLog(`job_start name=${name} start=${new Date(startedAt).toISOString()}`);
  try {
    return await fn();
  } finally {
    const endedAt = Date.now();
    inflight.delete(key);
    bridgeLog(
      `job_end name=${name} start=${new Date(startedAt).toISOString()} end=${new Date(endedAt).toISOString()} ms=${endedAt - startedAt}`,
    );
  }
}

function sampleEventLoop(hist: IntervalHistogram, sampleIndex: number): void {
  const p99Ms = hist.percentile(99) / 1e6;
  const maxMs = hist.max / 1e6;
  if (sampleIndex % VITALS_EVERY_SAMPLES === 0) {
    const mem = process.memoryUsage();
    bridgeLog(
      `vitals heap_mb=${(mem.heapUsed / 1048576).toFixed(1)} rss_mb=${(mem.rss / 1048576).toFixed(1)} lag_p99_ms=${p99Ms.toFixed(0)} lag_max_ms=${maxMs.toFixed(0)}`,
    );
  }
  if (shouldLogEventLoopLag(p99Ms)) {
    bridgeLog(
      `event_loop_lag p99_ms=${p99Ms.toFixed(0)} max_ms=${maxMs.toFixed(0)} inflight=${formatInflight(inflightJobs())}`,
    );
  }
  hist.reset();
}

/** p99 over 10s windows. Heap and RSS once a minute. Unref so tests can exit. */
export function startEventLoopMonitor(): void {
  if (monitorStarted || !eventLoopLogEnabled()) return;
  monitorStarted = true;
  const hist = monitorEventLoopDelay({ resolution: 10 });
  hist.enable();
  histogram = hist;
  let samples = 0;
  monitorTimer = setInterval(() => {
    samples += 1;
    sampleEventLoop(hist, samples);
  }, SAMPLE_MS);
  monitorTimer.unref();
  bridgeLog("event_loop_monitor start sample_ms=10000 lag_p99_ms=500");
}

export function stopEventLoopMonitorForTests(): void {
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = null;
  histogram?.disable();
  histogram = null;
  monitorStarted = false;
  inflight.clear();
}

function checkpointWorkerPath(): string {
  return path.join(process.cwd(), "scripts", "walCheckpointWorker.mjs");
}

/**
 * Copy WAL frames into the main database off the request thread.
 * The original hang stacks were sqlite3_wal_checkpoint inside Statement.run.
 */
export function checkpointWalOffThread(dbPath: string): Promise<WalCheckpointOffThreadResult> {
  if (checkpointInFlight) return checkpointInFlight;
  const pending = new Promise<WalCheckpointOffThreadResult>((resolve, reject) => {
    const worker = new Worker(checkpointWorkerPath(), { workerData: { dbPath } });
    let settled = false;
    const finish = (err: Error | null, result?: WalCheckpointOffThreadResult) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (err) reject(err);
      else resolve(result as WalCheckpointOffThreadResult);
    };
    const timer = setTimeout(() => {
      void worker.terminate();
      finish(new Error("wal_checkpoint_timeout"));
    }, 120_000);
    timer.unref();
    worker.once("message", (message: CheckpointWorkerMessage) => {
      if (message && message.ok === false) {
        finish(new Error(message.error || "wal_checkpoint_failed"));
        return;
      }
      finish(null, {
        busy: Number(message?.busy ?? 0),
        log: Number(message?.log ?? 0),
        checkpointed: Number(message?.checkpointed ?? 0),
      });
    });
    worker.once("error", (err) => finish(err));
    worker.once("exit", (code) => {
      if (!settled && code !== 0) finish(new Error(`wal_checkpoint_exit_${code}`));
    });
  });
  const tracked = pending.finally(() => {
    checkpointInFlight = null;
  });
  checkpointInFlight = tracked;
  return tracked;
}
