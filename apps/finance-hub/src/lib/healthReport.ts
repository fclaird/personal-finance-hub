export type HealthSchedulerSnapshot = {
  started: boolean;
  inFlight: boolean;
  overlapSkips: number;
  ticksStarted: number;
  lastTickAt: number;
  lastSlowRunAt: number;
  lastAccountValueRunAt: number;
};

export type HealthReport = {
  ok: true;
  pid: number;
  uptimeSec: number;
  memory: {
    rss: number;
    heapUsed: number;
    heapTotal: number;
    external: number;
  };
  handles: {
    active: number;
    requests: number;
  };
  scheduler: HealthSchedulerSnapshot;
  latestMigration: { name: string; applied_at: string } | null;
  /** Bytes in the SQLite WAL. Null when the file is absent. */
  walBytes: number | null;
  dbPath?: string;
};

type ProcWithHandles = NodeJS.Process & {
  _getActiveHandles?: () => unknown[];
  _getActiveRequests?: () => unknown[];
};

export function countOpenHandles(proc: ProcWithHandles = process): { active: number; requests: number } {
  return {
    active: proc._getActiveHandles?.().length ?? 0,
    requests: proc._getActiveRequests?.().length ?? 0,
  };
}

export function readProcessVitals(nowUptimeSec = Math.round(process.uptime())) {
  const mem = process.memoryUsage();
  return {
    pid: process.pid,
    uptimeSec: nowUptimeSec,
    memory: {
      rss: mem.rss,
      heapUsed: mem.heapUsed,
      heapTotal: mem.heapTotal,
      external: mem.external,
    },
    handles: countOpenHandles(),
  };
}

export function buildHealthReport(input: {
  vitals?: ReturnType<typeof readProcessVitals>;
  scheduler: HealthSchedulerSnapshot;
  latestMigration: { name: string; applied_at: string } | null;
  walBytes?: number | null;
  dbPath?: string | null;
}): HealthReport {
  const vitals = input.vitals ?? readProcessVitals();
  const report: HealthReport = {
    ok: true,
    ...vitals,
    scheduler: input.scheduler,
    latestMigration: input.latestMigration,
    walBytes: input.walBytes ?? null,
  };
  if (input.dbPath) report.dbPath = input.dbPath;
  return report;
}
