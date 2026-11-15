import fs from "node:fs";
import path from "node:path";

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
 * Restart only the dev server this process spawned.
 * A reused pid, init, this process, or a cwd outside the hub is refused.
 */
export function planRestart({ pid, cwd, root, selfPid }) {
  if (pid == null || !Number.isFinite(Number(pid)) || Number(pid) <= 1) {
    return { ok: false, reason: "no_child" };
  }
  const child = Number(pid);
  if (child === selfPid) return { ok: false, reason: "self" };
  if (!root || cwd !== root) return { ok: false, reason: "cwd" };
  return { ok: true, pid: child };
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
      const ok = await deps.probe();
      if (ok) {
        failures = 0;
        return { action: "ok" };
      }
      failures += 1;
      deps.log(`health_unresponsive consecutive=${failures} budget=${deps.failureBudget}`);
      if (failures < deps.failureBudget) return { action: "wait", failures };
      const pid = Number(deps.childPid());
      const decision = planRestart({
        pid,
        cwd: Number.isFinite(pid) ? deps.cwdOf(pid) : "",
        root: deps.root,
        selfPid: deps.selfPid,
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
