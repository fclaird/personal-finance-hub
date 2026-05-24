#!/usr/bin/env node
/**
 * Start Next dev with a Node binary that matches the better-sqlite3 native build.
 * On Apple Silicon, `npm run dev` often uses Homebrew x64 Node while postinstall built arm64.
 */
import { spawn, spawnSync, execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const DEV_PORT = Number(process.env.PORT ?? 3000) || 3000;
const lockPath = path.join(root, ".next", "dev", "lock");

function portListeners(port) {
  try {
    const out = execSync(`lsof -nP -iTCP:${port} -sTCP:LISTEN 2>/dev/null || true`, { encoding: "utf8" });
    return out
      .trim()
      .split("\n")
      .slice(1)
      .map((line) => {
        const parts = line.trim().split(/\s+/);
        return { command: parts[0], pid: parts[1] };
      })
      .filter((r) => r.pid);
  } catch {
    return [];
  }
}

function pidAlive(pid) {
  if (!pid || !Number.isFinite(pid)) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
}

function processCwd(pid) {
  try {
    return execSync(`lsof -a -p ${pid} -d cwd -Fn 2>/dev/null | sed -n 's/^n//p'`, { encoding: "utf8" }).trim();
  } catch {
    return "";
  }
}

function financeHubListenerPids() {
  const pids = new Set();
  for (let port = DEV_PORT; port <= DEV_PORT + 10; port++) {
    for (const { pid } of portListeners(port)) {
      const n = Number(pid);
      if (processCwd(n) === root) pids.add(n);
    }
  }
  return [...pids];
}

function readDevLock() {
  if (!fs.existsSync(lockPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(lockPath, "utf8"));
  } catch {
    return null;
  }
}

function stopPids(pids) {
  const unique = [...new Set(pids.filter((p) => pidAlive(p)))];
  for (const pid of unique) {
    try {
      process.kill(pid, "SIGTERM");
    } catch {
      /* ignore */
    }
  }
  if (unique.length === 0) return;
  spawnSync("sleep", ["0.5"]);
  for (const pid of unique) {
    if (pidAlive(pid)) {
      try {
        process.kill(pid, "SIGKILL");
      } catch {
        /* ignore */
      }
    }
  }
}

function clearStaleDevArtifacts() {
  fs.rmSync(path.join(root, ".next", "dev", "cache", "turbopack"), { recursive: true, force: true });
  fs.rmSync(lockPath, { force: true });
}

function ensureSingleDevServer(bindHost) {
  const restart = process.env.FINANCE_HUB_DEV_RESTART === "1";
  const lock = readDevLock();
  const listeners = financeHubListenerPids();
  const lockPidAlive = lock?.pid ? pidAlive(lock.pid) : false;

  if (lockPidAlive && !restart) {
    const url = `https://${bindHost}:${lock.port ?? DEV_PORT}`;
    console.log(`\nFinance Hub dev server is already running at ${url} (PID ${lock.pid}).`);
    console.log(`Open that URL in your browser. To restart: FINANCE_HUB_DEV_RESTART=1 npm run dev\n`);
    process.exit(0);
  }

  const toStop = [...new Set([...(lock?.pid ? [lock.pid] : []), ...listeners])];
  if (toStop.length > 0 || !lockPidAlive) {
    stopPids(toStop);
    clearStaleDevArtifacts();
  }
}

/** arm64 Node bundled with Cursor; override with FINANCE_HUB_NODE. */
const CURSOR_ARM64_NODE =
  "/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node";

function resolveDevNode() {
  if (process.env.FINANCE_HUB_NODE?.trim()) return process.env.FINANCE_HUB_NODE.trim();
  if (process.platform === "darwin" && process.arch === "x64") {
    try {
      const arch = spawnSync(CURSOR_ARM64_NODE, ["-p", "process.arch"], { encoding: "utf8" }).stdout?.trim();
      if (arch === "arm64") return CURSOR_ARM64_NODE;
    } catch {
      /* fall through */
    }
  }
  return process.execPath;
}

const nodeBin = resolveDevNode();

const ensure = spawnSync(nodeBin, ["scripts/ensure-sqlite-native.mjs"], {
  cwd: root,
  stdio: "inherit",
});
if (ensure.status !== 0) process.exit(ensure.status ?? 1);

const bindHost = (process.env.FINANCE_HUB_BIND_HOST ?? "127.0.0.1").trim() || "127.0.0.1";

ensureSingleDevServer(bindHost);

const nextArgs = [
  "node_modules/next/dist/bin/next",
  "dev",
  "--experimental-https",
  "--hostname",
  bindHost,
  "--port",
  String(DEV_PORT),
];
const child = spawn(nodeBin, nextArgs, { cwd: root, stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
