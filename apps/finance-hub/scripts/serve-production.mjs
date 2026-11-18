#!/usr/bin/env node
/**
 * Production supervisor for the Financial Bridge login launcher.
 * Builds when HEAD or the lockfile changed, then serves `next start` (HTTPS
 * when SCHWAB_REDIRECT_URI is https). Dev mode stays `npm run dev`.
 */
import { spawn, execSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  appendDevLog,
  createDevWatchdog,
  rotateOwnedLog,
  watchdogFailureBudget,
  watchdogGraceMs,
  watchdogHeapLimitBytes,
} from "./devWatchdog.mjs";
import { selectHubPids } from "./hubProcesses.mjs";
import { loadEnvLocal } from "./loadEnvLocal.mjs";
import { readLoopbackHealth } from "./loopbackHealth.mjs";
import {
  backupNextDir,
  ensureProductionBuild,
  formatBuildStamp,
  hashFile,
  readBuildStamp,
  resolveProductionNode,
  restoreNextDir,
} from "./productionLaunch.mjs";
import { resolveListen } from "./schwabListen.mjs";

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const repoRoot = path.join(root, "..", "..");
const nextDir = path.join(root, ".next");
const backupDir = path.join(root, ".next-last-good");
const stampPath = path.join(nextDir, "finance-hub-build-stamp");
const PORT = Number(process.env.PORT ?? 3000) || 3000;

function logDir() {
  if (process.platform === "darwin") return path.join(os.homedir(), "Library", "Logs", "finance-hub");
  return path.join(os.homedir(), ".local", "share", "finance-hub", "logs");
}

function logFile() {
  return path.join(logDir(), "bridge.log");
}

function log(line) {
  const text = `[bridge] ${line}`;
  console.log(text);
  try {
    rotateOwnedLog(logFile(), 8 * 1024 * 1024);
    appendDevLog(logFile(), line);
  } catch {
    /* best-effort */
  }
}

function gitHead() {
  const result = execSync("git rev-parse HEAD", { cwd: repoRoot, encoding: "utf8" });
  return result.trim();
}

function currentStamp() {
  return {
    head: gitHead(),
    lock: hashFile(path.join(root, "package-lock.json")),
  };
}

function hasBuild() {
  return fs.existsSync(path.join(nextDir, "BUILD_ID"));
}

function readSaved() {
  try {
    return readBuildStamp(fs.readFileSync(stampPath, "utf8"));
  } catch {
    return null;
  }
}

function writeSaved(stamp) {
  fs.mkdirSync(nextDir, { recursive: true });
  fs.writeFileSync(stampPath, formatBuildStamp(stamp));
}

function runBuild(nodeBin) {
  log("build_start");
  const bin = path.join(root, "node_modules", "next", "dist", "bin", "next");
  const result = spawnSync(nodeBin, [bin, "build"], {
    cwd: root,
    stdio: "inherit",
    env: { ...process.env, NODE_ENV: "production" },
  });
  if (result.status !== 0) {
    throw new Error(`next build exited ${result.status ?? result.signal ?? "unknown"}`);
  }
}

function processCommand(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 1) return "";
  try {
    return execSync(`ps -p ${n} -o command=`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function processCwd(pid) {
  try {
    return execSync(`lsof -a -p ${Number(pid)} -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'`, {
      encoding: "utf8",
    }).trim();
  } catch {
    return "";
  }
}

function listChildren(pid) {
  const n = Number(pid);
  if (!Number.isFinite(n) || n <= 1) return [];
  try {
    const out = execSync(`pgrep -P ${n}`, { encoding: "utf8" });
    return out
      .trim()
      .split("\n")
      .map((line) => Number(line))
      .filter((p) => Number.isFinite(p) && p > 1 && p !== process.pid);
  } catch {
    return [];
  }
}

function listeners(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null || true`, { encoding: "utf8" });
    return out
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return { pid: Number(parts[1]), command: parts[0] || "" };
      })
      .filter((row) => row.pid);
  } catch {
    return [];
  }
}

function repoProcesses() {
  let out = "";
  try {
    out = execSync("ps -ax -o pid=,command=", { encoding: "utf8" });
  } catch {
    return [];
  }
  const rows = [];
  for (const line of out.split("\n")) {
    const match = line.trim().match(/^(\d+)\s+([\s\S]+)$/);
    if (!match) continue;
    const pid = Number(match[1]);
    const command = match[2] || "";
    if (!command.includes(root) && !/next-server|\bnext\b/.test(command)) continue;
    rows.push({ pid, command, cwd: "", ports: [] });
  }
  return rows;
}

function stopPid(pid, signal) {
  try {
    process.kill(pid, signal);
  } catch {
    /* already gone */
  }
}

function stopTree(pids) {
  for (const pid of pids) {
    if (pid === process.pid || pid <= 1) continue;
    stopPid(pid, "SIGTERM");
  }
  spawnSync("sleep", ["0.4"]);
  for (const pid of pids) {
    if (pid === process.pid || pid <= 1) continue;
    try {
      process.kill(pid, 0);
      stopPid(pid, "SIGKILL");
    } catch {
      /* exited */
    }
  }
}

function collectDescendants(pid) {
  const order = [];
  const seen = new Set();
  function walk(current) {
    if (!current || current === process.pid || seen.has(current)) return;
    seen.add(current);
    for (const child of listChildren(current)) walk(child);
    order.push(current);
  }
  walk(pid);
  return order;
}

export function staleHubPids() {
  const byPid = new Map();
  for (const row of repoProcesses()) byPid.set(row.pid, { ...row, ports: [] });
  for (const row of listeners(PORT)) {
    const existing = byPid.get(row.pid) ?? { pid: row.pid, command: row.command, cwd: "", ports: [] };
    existing.ports = [...new Set([...(existing.ports || []), PORT])];
    if (!existing.command) existing.command = processCommand(row.pid) || row.command;
    if (!existing.cwd) existing.cwd = processCwd(row.pid);
    byPid.set(row.pid, existing);
  }
  return selectHubPids([...byPid.values()], { selfPid: process.pid, root, port: PORT });
}

function killStale() {
  const pids = staleHubPids();
  const tree = [];
  for (const pid of pids) tree.push(...collectDescendants(pid));
  const unique = [...new Set(tree)];
  if (unique.length === 0) return;
  log(`stopping stale hub pids=${unique.join(",")}`);
  stopTree(unique);
}

function listenPlan() {
  loadEnvLocal(root);
  return resolveListen({
    redirectUri: process.env.SCHWAB_REDIRECT_URI,
    port: PORT,
    bindHost: "127.0.0.1",
    mode: "start",
    certsPresent: true,
  });
}

function openWindow(origin) {
  if (process.env.FINANCE_HUB_OPEN_WINDOW === "0") return;
  const script = path.join(root, "scripts", "open-bridge-window.sh");
  const child = spawn(script, [origin], { stdio: "inherit" });
  child.on("error", (err) => log(`window_open_failed ${err.message}`));
}

function main() {
  const nodeBin = resolveProductionNode();
  log(`node=${nodeBin}`);
  fs.mkdirSync(logDir(), { recursive: true });
  fs.writeFileSync(path.join(logDir(), "bridge.pid"), String(process.pid));

  const outcome = ensureProductionBuild({
    current: currentStamp(),
    saved: readSaved(),
    hasBuild,
    backup: () => {
      backupNextDir(nextDir, backupDir);
      return true;
    },
    restore: () => restoreNextDir(nextDir, backupDir),
    runBuild: () => runBuild(nodeBin),
    writeStamp: writeSaved,
    log,
  });
  log(`build_action=${outcome.action}`);

  killStale();

  const plan = listenPlan();
  if (!plan.ok) {
    log(plan.message);
    process.exit(1);
  }

  const startScript = path.join(root, "scripts", "start.mjs");
  let childGeneration = 0;
  let nextChild = null;
  let suppressChildExit = false;
  let windowOpened = false;

  function spawnServer() {
    const generation = ++childGeneration;
    nextChild = spawn(nodeBin, [startScript], {
      cwd: root,
      stdio: "inherit",
      env: {
        ...process.env,
        NODE_ENV: "production",
        PORT: String(PORT),
        FINANCE_HUB_BIND_HOST: "127.0.0.1",
      },
    });
    log(`serve pid=${nextChild.pid} runtime=production origin=${plan.origin}`);
    nextChild.on("exit", (code, signal) => {
      if (suppressChildExit || generation !== childGeneration) return;
      log(`server_exit code=${code ?? ""} signal=${signal ?? ""}`);
      process.exit(code ?? 1);
    });
  }

  spawnServer();

  const dog = createDevWatchdog({
    failureBudget: watchdogFailureBudget(process.env),
    graceMs: watchdogGraceMs(process.env),
    heapLimitBytes: watchdogHeapLimitBytes(process.env),
    root,
    selfPid: process.pid,
    log,
    probe: async () => {
      const report = await readLoopbackHealth(PORT, 5_000, plan.protocol);
      if (report && !windowOpened) {
        windowOpened = true;
        openWindow(plan.origin);
      }
      return report;
    },
    childPid: () => nextChild?.pid,
    cwdOf: processCwd,
    commandOf: processCommand,
    listChildren,
    killTree: (pids) => {
      suppressChildExit = true;
      stopTree(pids.filter((pid) => pid !== process.pid));
    },
    onRestart: async () => {
      spawnServer();
      suppressChildExit = false;
    },
  });
  const timer = setInterval(() => {
    void dog.tick().catch((err) => log(`watchdog_tick_failed ${err instanceof Error ? err.message : String(err)}`));
  }, 60_000);
  timer.unref();
  log(
    `watchdog armed grace_ms=${watchdogGraceMs(process.env)} failures=${watchdogFailureBudget(process.env)} heap_mb=${
      watchdogHeapLimitBytes(process.env) / (1024 * 1024)
    }`,
  );

  const shutdown = (signal) => {
    log(`shutdown signal=${signal}`);
    suppressChildExit = true;
    if (nextChild?.pid) stopTree(collectDescendants(nextChild.pid));
    try {
      fs.rmSync(path.join(logDir(), "bridge.pid"), { force: true });
    } catch {
      /* ignore */
    }
    process.exit(0);
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    log(err instanceof Error ? err.stack || err.message : String(err));
    process.exit(1);
  }
}
