import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, spawnSync } from "node:child_process";

/** arm64 Node Chris installed for Financial Bridge. Override with FINANCE_HUB_NODE. */
export const FINANCE_HUB_ARM64_NODE_REL = path.join(".local", "opt", "node-arm64");

/** arm64 Node bundled with Cursor, used only when the home install is missing. */
export const CURSOR_ARM64_NODE =
  "/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node";

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

/** Re-exec this process on the resolved Node. Returns true when a child was spawned. */
export function reexecFinanceHubNode(scriptArgs) {
  const nodeBin = resolveFinanceHubNode();
  if (path.resolve(nodeBin) === path.resolve(process.execPath)) return false;
  const child = spawn(nodeBin, scriptArgs, {
    stdio: "inherit",
    env: { ...process.env, FINANCE_HUB_NODE: nodeBin },
  });
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
