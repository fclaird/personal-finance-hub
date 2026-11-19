import fs from "node:fs";
import inspector from "node:inspector";
import os from "node:os";
import path from "node:path";
import { monitorEventLoopDelay, PerformanceObserver, type IntervalHistogram } from "node:perf_hooks";
import { Worker } from "node:worker_threads";

/** Log a lag spike when the 10s p99 crosses this. */
export const EVENT_LOOP_LAG_P99_MS = 500;
/** Soak harness fails above these. Logged on every 10s window that crosses either. */
export const SOAK_LAG_P99_MS = 200;
export const SOAK_LAG_MAX_MS = 1000;
/** No synchronous slice on the request thread should run longer than this before yielding. */
export const SYNC_SLICE_MS = 50;
const SAMPLE_MS = 10_000;
const VITALS_EVERY_SAMPLES = 6;

export type InflightJob = { name: string; startedAt: number };

export type WalCheckpointOffThreadResult = {
  busy: number;
  log: number;
  checkpointed: number;
};

type CheckpointWorkerMessage = WalCheckpointOffThreadResult & { ok?: boolean; error?: string };

export type YahooChartSlim = {
  meta: Record<string, unknown> | null;
  timestamp: number[];
  close: Array<number | null>;
  events: unknown;
};

const inflight = new Map<string, InflightJob>();
let monitorStarted = false;
let monitorTimer: NodeJS.Timeout | null = null;
let histogram: IntervalHistogram | null = null;
let checkpointInFlight: Promise<WalCheckpointOffThreadResult> | null = null;
let peakP99Ms = 0;
let peakMaxMs = 0;
let lastGc = "none";
let profileSummary = "none";
let profiler: inspector.Session | null = null;
let jsonWorker: Worker | null = null;
let jsonSeq = 0;
const jsonPending = new Map<number, { resolve: (value: unknown) => void; reject: (err: Error) => void }>();

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
  // setTimeout lets HTTP and the lag monitor run. A burst of setImmediate
  // callbacks still runs in one check-phase turn, which is how parallel
  // chart fetches spawned every curl before /api/health could run.
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

/** Yield once the current synchronous slice has been on the thread for 50ms. */
export function createSlicePacer(limitMs = SYNC_SLICE_MS) {
  let start = Date.now();
  return async function pace() {
    if (Date.now() - start >= limitMs) {
      await yieldEventLoop();
      start = Date.now();
    }
  };
}

function jsonWorkerPath(): string {
  return path.join(process.cwd(), "scripts", "jsonWorker.mjs");
}

function ensureJsonWorker(): Worker {
  if (jsonWorker) return jsonWorker;
  const worker = new Worker(jsonWorkerPath());
  worker.on("message", (msg: { id: number; ok: boolean; value?: unknown; error?: string }) => {
    const pending = jsonPending.get(msg.id);
    if (!pending) return;
    jsonPending.delete(msg.id);
    if (jsonPending.size === 0) worker.unref();
    if (msg.ok) pending.resolve(msg.value ?? null);
    else pending.reject(new Error(msg.error || "json_parse_failed"));
  });
  worker.once("exit", () => {
    jsonWorker = null;
    for (const [id, pending] of jsonPending) {
      jsonPending.delete(id);
      pending.reject(new Error("json_worker_exit"));
    }
  });
  worker.unref();
  jsonWorker = worker;
  return worker;
}

/**
 * Parse a large Yahoo chart off the request thread. The worker returns meta,
 * timestamps, closes, and events — not the raw multi-megabyte document.
 */
function postJsonWorker<T>(payload: { op?: string; bytes: Uint8Array; placeIds?: string[] }): Promise<T | null> {
  const copy = new Uint8Array(payload.bytes.byteLength);
  copy.set(payload.bytes);
  const id = ++jsonSeq;
  return new Promise((resolve, reject) => {
    jsonPending.set(id, {
      resolve: (value) => resolve((value ?? null) as T | null),
      reject,
    });
    const worker = ensureJsonWorker();
    worker.ref();
    worker.postMessage({ id, op: payload.op, bytes: copy, placeIds: payload.placeIds }, [copy.buffer]);
  });
}

export function parseYahooChartOffThread(bytes: Uint8Array): Promise<YahooChartSlim | null> {
  return postJsonWorker<YahooChartSlim>({ bytes });
}

/** Parse the FHFA master CSV off the request thread. The file is large; the matching rows are not. */
export function fetchFhfaOffThread(
  placeIds: readonly string[],
): Promise<Array<{ seriesId: string; period: string; index: number }>> {
  const id = ++jsonSeq;
  return new Promise((resolve, reject) => {
    jsonPending.set(id, {
      resolve: (value) => resolve((value as Array<{ seriesId: string; period: string; index: number }> | null) ?? []),
      reject,
    });
    const worker = ensureJsonWorker();
    worker.ref();
    worker.postMessage({ id, op: "fhfa-fetch", placeIds: [...placeIds] });
  });
}

export function yahooChartFromSlim(slim: YahooChartSlim | null): Record<string, unknown> | null {
  if (!slim?.meta) return null;
  return {
    meta: slim.meta,
    timestamp: slim.timestamp,
    indicators: { quote: [{ close: slim.close }] },
    events: slim.events,
  };
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

type ProfileNode = {
  id: number;
  hitCount?: number;
  parent?: number;
  callFrame?: { functionName?: string; url?: string };
};

function summarizeProfile(profile: { nodes?: ProfileNode[] } | undefined): string {
  const nodes = profile?.nodes ?? [];
  if (nodes.length === 0) return "none";
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const ranked = nodes
    .filter((node) => (node.hitCount ?? 0) > 0)
    .sort((a, b) => (b.hitCount ?? 0) - (a.hitCount ?? 0))
    .slice(0, 5);
  if (ranked.length === 0) return "none";
  return ranked
    .map((node) => {
      const frames: string[] = [];
      let cur: ProfileNode | undefined = node;
      for (let i = 0; i < 6 && cur; i++) {
        const name = cur.callFrame?.functionName || "(anon)";
        frames.push(name);
        cur = cur.parent != null ? byId.get(cur.parent) : undefined;
      }
      return `${node.hitCount}:${frames.join("<")}`;
    })
    .join(" | ");
}

function rotateProfiler(onSummary: (text: string) => void): void {
  if (!profiler) return;
  profiler.post("Profiler.stop", (err, params) => {
    if (!err) onSummary(summarizeProfile(params?.profile as { nodes?: ProfileNode[] } | undefined));
    try {
      profiler?.post("Profiler.start");
    } catch {
      profiler = null;
    }
  });
}

function startProfiler(): void {
  try {
    const session = new inspector.Session();
    session.connect();
    profiler = session;
    session.post("Profiler.enable");
    session.post("Profiler.setSamplingInterval", { interval: 10_000 });
    session.post("Profiler.start");
  } catch (err) {
    profiler = null;
    bridgeLog(`profiler_off ${err instanceof Error ? err.message : String(err)}`);
  }
}

function startGcObserver(): void {
  try {
    const obs = new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) {
        if (entry.duration < SYNC_SLICE_MS) continue;
        const kind = (entry as { detail?: { kind?: string } }).detail?.kind ?? entry.name;
        lastGc = `duration_ms=${entry.duration.toFixed(0)} kind=${kind}`;
        bridgeLog(`gc ${lastGc} inflight=${formatInflight(inflightJobs())}`);
      }
    });
    obs.observe({ entryTypes: ["gc"] });
  } catch (err) {
    bridgeLog(`gc_observer_off ${err instanceof Error ? err.message : String(err)}`);
  }
}

function sampleEventLoop(hist: IntervalHistogram, sampleIndex: number): void {
  const p99Ms = hist.percentile(99) / 1e6;
  const maxMs = hist.max / 1e6;
  peakP99Ms = Math.max(peakP99Ms, p99Ms);
  peakMaxMs = Math.max(peakMaxMs, maxMs);
  const stalled = p99Ms > SOAK_LAG_P99_MS || maxMs > SOAK_LAG_MAX_MS;
  const inflightText = formatInflight(inflightJobs());
  const gcText = lastGc;
  if (stalled) {
    bridgeLog(
      `event_loop_lag p99_ms=${p99Ms.toFixed(0)} max_ms=${maxMs.toFixed(0)} inflight=${inflightText} gc=${gcText} stacks=${profileSummary}`,
    );
    rotateProfiler((text) => {
      profileSummary = text;
      if (text !== "none") {
        bridgeLog(`event_loop_stacks p99_ms=${p99Ms.toFixed(0)} max_ms=${maxMs.toFixed(0)} stacks=${text}`);
      }
    });
  }
  if (sampleIndex % VITALS_EVERY_SAMPLES === 0) {
    const mem = process.memoryUsage();
    bridgeLog(
      `vitals heap_mb=${(mem.heapUsed / 1048576).toFixed(1)} rss_mb=${(mem.rss / 1048576).toFixed(1)} external_mb=${(mem.external / 1048576).toFixed(1)} array_buffers_mb=${((mem.arrayBuffers ?? 0) / 1048576).toFixed(1)} lag_p99_ms=${peakP99Ms.toFixed(0)} lag_max_ms=${peakMaxMs.toFixed(0)}`,
    );
    peakP99Ms = 0;
    peakMaxMs = 0;
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
  startProfiler();
  startGcObserver();
  let samples = 0;
  monitorTimer = setInterval(() => {
    samples += 1;
    sampleEventLoop(hist, samples);
  }, SAMPLE_MS);
  monitorTimer.unref();
  bridgeLog("event_loop_monitor start sample_ms=10000 lag_p99_ms=200 lag_max_ms=1000");
}

export function stopEventLoopMonitorForTests(): void {
  if (monitorTimer) clearInterval(monitorTimer);
  monitorTimer = null;
  histogram?.disable();
  histogram = null;
  try {
    profiler?.disconnect();
  } catch {
    /* already disconnected */
  }
  profiler = null;
  monitorStarted = false;
  inflight.clear();
  peakP99Ms = 0;
  peakMaxMs = 0;
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
