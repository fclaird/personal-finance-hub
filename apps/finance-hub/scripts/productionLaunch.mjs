import crypto from "node:crypto";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

export const INTEL_NODE = "/usr/local/bin/node";

/**
 * Darwin login launcher must use Homebrew Intel Node.
 * Other platforms (CI) may pass FINANCE_HUB_NODE or the current binary.
 */
export function resolveProductionNode({
  platform = process.platform,
  env = process.env,
  execPath = process.execPath,
  exists = (file) => fs.existsSync(file),
  archOf = readNodeArch,
} = {}) {
  if (platform === "darwin") {
    if (!exists(INTEL_NODE)) {
      throw new Error(`Refusing to start. Intel Node is not at ${INTEL_NODE}.`);
    }
    const arch = archOf(INTEL_NODE);
    if (arch !== "x64") {
      throw new Error(`Refusing ${INTEL_NODE} (process.arch=${arch || "unknown"}). Financial Bridge requires x64, not arm64.`);
    }
    return INTEL_NODE;
  }
  const override = env.FINANCE_HUB_NODE?.trim();
  return override || execPath;
}

export function readNodeArch(nodeBin) {
  const result = spawnSync(nodeBin, ["-p", "process.arch"], { encoding: "utf8" });
  if (result.status !== 0) return "";
  return (result.stdout || "").trim();
}

export function hashFile(filePath) {
  const data = fs.readFileSync(filePath);
  return crypto.createHash("sha256").update(data).digest("hex");
}

export function readBuildStamp(text) {
  const [head = "", lock = ""] = String(text ?? "").split("\n");
  return { head: head.trim(), lock: lock.trim() };
}

export function formatBuildStamp({ head, lock }) {
  return `${head}\n${lock}\n`;
}

export function needsRebuild(saved, current, hasBuild) {
  if (!hasBuild) return true;
  if (!saved || !saved.head || !saved.lock) return true;
  return saved.head !== current.head || saved.lock !== current.lock;
}

export function backupNextDir(nextDir, backupDir) {
  fs.rmSync(backupDir, { recursive: true, force: true });
  fs.cpSync(nextDir, backupDir, { recursive: true });
}

export function restoreNextDir(nextDir, backupDir) {
  const marker = path.join(backupDir, "BUILD_ID");
  if (!fs.existsSync(marker)) return false;
  fs.rmSync(nextDir, { recursive: true, force: true });
  fs.cpSync(backupDir, nextDir, { recursive: true });
  return true;
}

/**
 * Rebuild only when HEAD or the lockfile changed.
 * A failed build puts the previous .next back when that backup exists.
 */
export function ensureProductionBuild({
  current,
  saved,
  hasBuild,
  backup,
  restore,
  runBuild,
  writeStamp,
  log = () => {},
}) {
  if (!needsRebuild(saved, current, hasBuild)) {
    log("build_skipped");
    return { action: "skip" };
  }
  const backedUp = hasBuild ? Boolean(backup()) : false;
  try {
    runBuild();
    if (!hasBuild()) throw new Error("next build finished without BUILD_ID");
    writeStamp(current);
    log("build_ok");
    return { action: "built" };
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    log(`build_failed ${message}`);
    if (backedUp && restore()) {
      log("serving_last_good_build");
      return { action: "kept-last-good", error: message };
    }
    if (hasBuild()) {
      log("serving_last_good_build");
      return { action: "kept-last-good", error: message };
    }
    throw err;
  }
}
