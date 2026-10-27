import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

/** arm64 Node Chris installed for Financial Bridge. Override with FINANCE_HUB_NODE. */
export const FINANCE_HUB_ARM64_NODE_REL = path.join(".local", "opt", "node-arm64");

/** arm64 Node bundled with Cursor, used only when the home install is missing. */
export const CURSOR_ARM64_NODE =
  "/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node";

/**
 * Set on the re-exec child. A second hop must not spawn again.
 * ~/.local/opt/node-arm64/bin/node is a symlink; process.execPath is the real
 * binary, so a path-string compare re-execs forever (spawn EAGAIN).
 */
export const FINANCE_HUB_REEXEC_ENV = "FINANCE_HUB_REEXEC";

/** Next.js 16 requires Node 20.9+. An arm64 binary at or above that stays put. */
export function nodeVersionAcceptable(version) {
  const match = /^v?(\d+)\.(\d+)/.exec(String(version ?? "").trim());
  if (!match) return false;
  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (!Number.isFinite(major) || !Number.isFinite(minor)) return false;
  if (major > 20) return true;
  return major === 20 && minor >= 9;
}

export function arm64NodeCandidates(home = os.homedir()) {
  const prefix = path.join(home, FINANCE_HUB_ARM64_NODE_REL);
  return [path.join(prefix, "bin", "node"), prefix, CURSOR_ARM64_NODE];
}

function defaultArchOf(bin) {
  if (!bin || !fs.existsSync(bin)) return null;
  const result = spawnSync(bin, ["-p", "process.arch"], { encoding: "utf8" });
  if (result.status !== 0) return null;
  return result.stdout.trim() || null;
}

/** Follow every symlink. path.resolve does not, and that mismatch caused the respawn loop. */
export function canonicalNodePath(bin) {
  if (!bin) return null;
  try {
    return fs.realpathSync(bin);
  } catch {
    return null;
  }
}

export function sameNodeBinary(a, b) {
  const left = canonicalNodePath(a);
  const right = canonicalNodePath(b);
  return left != null && left === right;
}

/**
 * Prefer an arm64 Node on macOS (home install, then Cursor's helper).
 * FINANCE_HUB_NODE wins when it is set. Otherwise the current binary is the fallback.
 */
export function resolveFinanceHubNode(opts = {}) {
  const env = opts?.env ?? process.env;
  const platform = opts?.platform ?? process.platform;
  const execPath = opts?.execPath ?? process.execPath;
  const archOf = opts?.archOf ?? defaultArchOf;
  const explicit = env.FINANCE_HUB_NODE?.trim();
  if (explicit) {
    if (!fs.existsSync(explicit)) {
      throw new Error(`FINANCE_HUB_NODE does not exist: ${explicit}`);
    }
    return explicit;
  }
  if (platform === "darwin") {
    for (const candidate of arm64NodeCandidates(opts?.home)) {
      if (archOf(candidate) === "arm64") return candidate;
    }
  }
  return execPath;
}

/**
 * Null when this process should keep running.
 * Order: hard one-hop guard, already-good arm64, then realpath equality.
 */
export function shouldReexecFinanceHubNode(opts = {}) {
  const env = opts.env ?? process.env;
  if (String(env[FINANCE_HUB_REEXEC_ENV] ?? "") === "1") return null;
  const arch = opts.arch ?? process.arch;
  const version = opts.version ?? process.version;
  if (arch === "arm64" && nodeVersionAcceptable(version)) return null;
  const execPath = opts.execPath ?? process.execPath;
  const nodeBin = resolveFinanceHubNode({ ...opts, env, execPath });
  if (sameNodeBinary(nodeBin, execPath)) return null;
  return nodeBin;
}

/** Re-exec this process on the resolved Node. Returns true when a child was spawned. */
export function reexecFinanceHubNode(scriptArgs, opts = {}) {
  const nodeBin = shouldReexecFinanceHubNode(opts);
  if (!nodeBin) return false;
  const spawnFn = opts.spawn ?? spawn;
  const baseEnv = opts.env ?? process.env;
  const canonical = canonicalNodePath(nodeBin) ?? nodeBin;
  const child = spawnFn(canonical, scriptArgs, {
    stdio: "inherit",
    env: { ...baseEnv, FINANCE_HUB_NODE: canonical, [FINANCE_HUB_REEXEC_ENV]: "1" },
  });
  if (spawnFn !== spawn) return true;
  child.on("exit", (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exit(code ?? 0);
  });
  child.on("error", (err) => {
    console.error(err);
    process.exit(1);
  });
  return true;
}
