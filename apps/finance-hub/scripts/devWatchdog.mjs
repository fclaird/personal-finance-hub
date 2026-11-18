import fs from "node:fs";
import path from "node:path";

/** macOS lsof reports /private/var for /var. Next's wrapper cwd is often not the hub root. */
export function sameHubPath(cwd, root) {
  if (!cwd || !root) return false;
  const norm = (value) => path.resolve(String(value)).replace(/\/+$/, "");
  const strip = (value) => norm(value).replace(/^\/private(?=\/)/, "");
  const a = strip(cwd);
  const b = strip(root);
  return a === b || a.startsWith(`${b}${path.sep}`);
}

export function isHubNextCommand(command) {
  const text = String(command ?? "");
  if (!text) return false;
  if (/next-server/.test(text)) return true;
  if (/scripts\/(?:start|dev|serve-production)\.mjs/.test(text)) return true;
  return /\bnext\b/.test(text) && (/\bdev\b/.test(text) || /\bstart\b/.test(text));
}

/** Off unless explicitly armed. "true" and "yes" do not count. */
export function watchdogEnabled(env = process.env) {
  return env.FINANCE_HUB_DEV_WATCHDOG === "1";
}

export function watchdogFailureBudget(env = process.env) {
  const raw = Number(env.FINANCE_HUB_DEV_WATCHDOG_MINUTES ?? 3);
  if (!Number.isFinite(raw) || raw < 1) return 3;
  return Math.floor(raw);
}

export function watchdogGraceMs(env = process.env) {
  const raw = Number(env.FINANCE_HUB_DEV_WATCHDOG_GRACE_MS ?? 120_000);
  if (!Number.isFinite(raw) || raw < 0) return 120_000;
  return raw;
}

/**
 * Restart the next-server tree this process spawned.
 * The `next dev` wrapper's cwd often does not equal the hub root (the 24h soak
 * refused every restart with reason=cwd pid=<next dev>). A descendant whose
 * command is next-server, or a wrapper command that is `next dev`, is enough.
 * An unrelated node process, init, or this process is still refused.
 */
export function planRestart({ pid, cwd, root, selfPid, command, childCommands }) {
  if (pid == null || !Number.isFinite(Number(pid)) || Number(pid) <= 1) {
    return { ok: false, reason: "no_child" };
  }
  const child = Number(pid);
  if (child === selfPid) return { ok: false, reason: "self" };
  const commands = [command, ...(childCommands ?? [])];
  const ownsNext = commands.some((entry) => isHubNextCommand(entry));
  if (!sameHubPath(cwd, root) && !ownsNext) return { ok: false, reason: "cwd" };
  return { ok: true, pid: child };
}

/** Health answered, but the dev heap has grown past the watchdog cap. */
export function healthProbeFailure(report, heapLimitBytes) {
  if (!report || report.ok !== true) return "unresponsive";
  const heap = report.memory && report.memory.heapUsed;
  if (heapLimitBytes > 0 && typeof heap === "number" && heap > heapLimitBytes) return "heap";
  return null;
}

export function watchdogHeapLimitBytes(env = process.env) {
  const raw = Number(env.FINANCE_HUB_DEV_WATCHDOG_HEAP_MB ?? 1536);
  if (!Number.isFinite(raw) || raw <= 0) return 0;
  return Math.floor(raw) * 1024 * 1024;
}

/** Children first, so a worker is not reparented when the Next parent exits. */
export function collectRestartPids(rootPid, listChildren, selfPid) {
  const order = [];
  const seen = new Set();
  function walk(pid) {
    const n = Number(pid);
    if (!Number.isFinite(n) || n <= 1 || n === selfPid || seen.has(n)) return;
    seen.add(n);
    const children = listChildren(n) ?? [];
    for (const child of children) walk(child);
    order.push(n);
  }
  walk(rootPid);
  return order;
}

export const DEV_LOG_MAX_BYTES = 8 * 1024 * 1024;

/**
 * Rotate in place. launchd keeps the same stdout fd open with O_APPEND, so
 * renaming the file would leave it writing the deleted inode. Copy then truncate.
 */
export function rotateOwnedLog(logPath, maxBytes = DEV_LOG_MAX_BYTES) {
  let size = 0;
  try {
    size = fs.statSync(logPath).size;
  } catch {
    return false;
  }
  if (size <= maxBytes) return false;
  fs.copyFileSync(logPath, `${logPath}.1`);
  fs.truncateSync(logPath, 0);
  return true;
}

export function appendDevLog(logPath, line) {
  fs.mkdirSync(path.dirname(logPath), { recursive: true });
  fs.appendFileSync(logPath, `[${new Date().toISOString()}] [dev-watchdog] ${line}\n`);
}

/**
 * Probe /api/health. After `failureBudget` consecutive failures, kill only the
 * spawned next-server tree and let the caller start it again.
 */
export function createDevWatchdog(deps) {
  let failures = 0;
  let armedAt = Date.now();
  let restarting = false;

  return {
    noteSpawn(now = Date.now()) {
      failures = 0;
      armedAt = now;
    },
    async tick(now = Date.now()) {
      if (restarting) return { action: "busy" };
      if (now - armedAt < deps.graceMs) return { action: "grace" };
      const report = await deps.probe();
      const heapLimit = deps.heapLimitBytes ?? 0;
      const failure = healthProbeFailure(report, heapLimit);
      if (!failure) {
        failures = 0;
        return { action: "ok" };
      }
      failures += 1;
      const heap = report && report.memory ? report.memory.heapUsed : "";
      deps.log(
        `health_unresponsive reason=${failure} consecutive=${failures} budget=${deps.failureBudget} heap_used=${heap}`,
      );
      if (failures < deps.failureBudget) return { action: "wait", failures };
      const pid = Number(deps.childPid());
      const childPids = Number.isFinite(pid) ? (deps.listChildren(pid) ?? []) : [];
      const commandOf = deps.commandOf ?? (() => "");
      const decision = planRestart({
        pid,
        cwd: Number.isFinite(pid) ? deps.cwdOf(pid) : "",
        root: deps.root,
        selfPid: deps.selfPid,
        command: Number.isFinite(pid) ? commandOf(pid) : "",
        childCommands: childPids.map((child) => commandOf(child)),
      });
      if (!decision.ok) {
        deps.log(`restart_refused reason=${decision.reason} pid=${Number.isFinite(pid) ? pid : ""}`);
        return { action: "refused", reason: decision.reason };
      }
      const pids = collectRestartPids(pid, deps.listChildren, deps.selfPid);
      restarting = true;
      try {
        deps.log(`restarting next-server pids=${pids.join(",")}`);
        deps.killTree(pids);
        await deps.onRestart();
        failures = 0;
        armedAt = Date.now();
      } finally {
        restarting = false;
      }
      return { action: "restarted", pids };
    },
  };
}
