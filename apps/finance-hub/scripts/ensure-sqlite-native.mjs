#!/usr/bin/env node
/**
 * Load better-sqlite3 under this Node, or rebuild it with the npm that sits
 * beside this Node.
 *
 * Do not exec prebuild-install/bin.js directly. better-sqlite3's install
 * script is `prebuild-install || node-gyp rebuild --release`. prebuild-install
 * exits 1 on purpose when npm_config_build_from_source is set (and when the
 * GitHub download fails) so npm can run node-gyp. A direct exec stops there:
 * "Command failed: .../prebuild-install/bin.js". `npm rebuild --build-from-source`
 * is the path that actually compiles.
 *
 * Dock PATH often still has /usr/local/bin/npm (Intel). Use the npm next to
 * process.execPath, which the launcher has already selected as arm64.
 * Do not pin @tailwindcss/oxide-darwin-x64 or lightningcss-darwin-x64.
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

import {
  backupSqliteNative,
  restoreSqliteNative,
  sqliteBackupDir,
  sqlitePackageDir,
} from "./sqliteStandalone.mjs";

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));

const SQLITE_PROBE = `
const { createRequire } = require("module");
const req = createRequire(process.argv[1]);
const Database = req("better-sqlite3");
const db = new Database(":memory:");
db.close();
process.stdout.write(req.resolve("better-sqlite3"));
`;

export function npmCandidatesForNode(execPath, home = os.homedir()) {
  const npmName = process.platform === "win32" ? "npm.cmd" : "npm";
  const beside = path.join(path.dirname(execPath), npmName);
  const homeNpm = path.join(home, ".local", "opt", "node-arm64", "bin", npmName);
  return beside === homeNpm ? [beside] : [beside, homeNpm];
}

/** npm that belongs to this Node, not whichever npm happens to be on PATH. */
export function npmBinForNode(execPath, existsSync = fs.existsSync, home = os.homedir()) {
  for (const candidate of npmCandidatesForNode(execPath, home)) {
    if (existsSync(candidate)) return candidate;
  }
  return null;
}

export function sqliteRebuildCommand() {
  return ["rebuild", "better-sqlite3", "--build-from-source"];
}

export function pathWithNodeBinFirst(env, execPath) {
  const key = process.platform === "win32" ? "Path" : "PATH";
  const binDir = path.dirname(execPath);
  const current = env[key] ?? env.PATH ?? "";
  const parts = String(current)
    .split(path.delimiter)
    .filter((part) => part && part !== binDir);
  return { ...env, [key]: [binDir, ...parts].join(path.delimiter) };
}

export function probeSqliteNative(nodeBin, appRoot, spawnFn = spawnSync) {
  const result = spawnFn(nodeBin, ["-e", SQLITE_PROBE, path.join(appRoot, "package.json")], {
    cwd: appRoot,
    encoding: "utf8",
    env: process.env,
  });
  const error = `${result.stderr || ""}${result.error ? result.error.message : ""}`.trim();
  return {
    ok: result.status === 0,
    resolved: (result.stdout || "").trim(),
    error,
  };
}

/**
 * Skip the rebuild when require("better-sqlite3") already works under nodeBin.
 * Otherwise rebuild once with that Node's npm. Never deletes build/ first.
 */
export function ensureSqliteNative(opts = {}) {
  const nodeBin = opts.nodeBin ?? process.execPath;
  const appRoot = opts.appRoot ?? root;
  const existsSync = opts.existsSync ?? fs.existsSync;
  const home = opts.home ?? os.homedir();
  const spawnFn = opts.spawnSync ?? spawnSync;
  const probeFn = opts.probe ?? ((bin, dir) => probeSqliteNative(bin, dir, spawnFn));
  const env = opts.env ?? process.env;
  const log = opts.log ?? console.warn;

  const first = probeFn(nodeBin, appRoot);
  if (first.ok) return { rebuilt: false, resolved: first.resolved };

  const npmBin = opts.npmBin ?? npmBinForNode(nodeBin, existsSync, home);
  if (!npmBin) {
    throw new Error(
      `better-sqlite3 did not load under ${nodeBin}, and that Node has no npm beside it.\n` +
        "Install the arm64 Node at ~/.local/opt/node-arm64 (it includes npm), then retry.\n" +
        first.error,
    );
  }

  log(`[finance-hub] better-sqlite3 did not load under ${nodeBin} (${process.version} ${process.arch}).`);
  if (first.resolved) log(`[finance-hub] Resolved module: ${first.resolved}`);
  const detail = first.error.split("\n").find((line) => line.trim()) ?? first.error;
  if (detail) log(`[finance-hub] ${detail}`);
  log(
    "[finance-hub] prebuild-install exits 1 when a from-source build is requested; it does not compile. npm runs node-gyp next.",
  );
  log(`[finance-hub] ${npmBin} ${sqliteRebuildCommand().join(" ")}`);

  const pkgDir = sqlitePackageDir(appRoot);
  const backupDir = sqliteBackupDir(appRoot);
  if (pkgDir) backupSqliteNative(pkgDir, backupDir);

  const rebuild = spawnFn(npmBin, sqliteRebuildCommand(), {
    cwd: appRoot,
    stdio: opts.stdio ?? "inherit",
    env: pathWithNodeBinFirst(env, nodeBin),
  });
  if (rebuild.status !== 0) {
    if (pkgDir) restoreSqliteNative(pkgDir, backupDir);
    throw new Error(
      `npm rebuild better-sqlite3 --build-from-source failed (exit ${rebuild.status ?? "signal"}). ` +
        `npm was ${npmBin}. A PATH npm such as /usr/local/bin/npm is not used. ` +
        "Any build/ that node-gyp removed was restored from a copy when a backup existed.",
    );
  }

  const again = probeFn(nodeBin, appRoot);
  if (!again.ok) {
    if (pkgDir) restoreSqliteNative(pkgDir, backupDir);
    throw new Error(`better-sqlite3 still did not load after rebuild.\n${again.error}`);
  }
  log("[finance-hub] better-sqlite3 rebuild OK.");
  return { rebuilt: true, resolved: again.resolved };
}

function resolveNpmBin() {
  return (
    npmBinForNode(process.execPath) ??
    spawnSync("command", ["-v", "npm"], { encoding: "utf8", shell: true }).stdout?.trim() ??
    "npm"
  );
}

function ensureOptionalNative(pkgName, loadFn) {
  try {
    loadFn();
    return;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    const looksNative =
      msg.includes("Cannot find module") ||
      msg.includes("Cannot find native binding") ||
      msg.includes("lightningcss.");
    if (!looksNative || process.platform !== "darwin") {
      console.error(`[finance-hub] ${pkgName} failed to load:`, msg);
      process.exit(1);
    }
  }

  const version = require(`${pkgName}/package.json`).version;
  const platformPkg = `${pkgName}-darwin-${process.arch}`;
  const npmBin = resolveNpmBin();
  console.warn(
    `[finance-hub] Installing ${platformPkg}@${version} for Node ${process.version} (${process.arch}) with ${npmBin}…`,
  );
  try {
    execSync(`"${npmBin}" install ${platformPkg}@${version} --force`, {
      stdio: "inherit",
      cwd: root,
      env: pathWithNodeBinFirst(process.env, process.execPath),
    });
    loadFn();
    console.warn(`[finance-hub] ${pkgName} native module OK.`);
  } catch (installErr) {
    console.error(
      `[finance-hub] ${pkgName} native module missing.\n` +
        `  Node: ${process.version} (${process.arch})\n` +
        `  Fix: ${npmBin} install ${platformPkg}@${version} --force`,
    );
    console.error(installErr instanceof Error ? installErr.message : installErr);
    process.exit(1);
  }
}

function main() {
  ensureSqliteNative();
  ensureOptionalNative("lightningcss", () => {
    require("lightningcss");
  });
  ensureOptionalNative("@tailwindcss/oxide", () => {
    require("@tailwindcss/oxide");
  });
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  try {
    main();
  } catch (err) {
    console.error("[finance-hub] better-sqlite3 architecture mismatch.");
    console.error(err instanceof Error ? err.message : err);
    console.error(
      `  Node: ${process.version} (${process.arch}) ${process.execPath}\n` +
        "  The launcher uses the npm next to that Node, not PATH's npm.\n" +
        "  Hand equivalent:\n" +
        `    export PATH="${path.dirname(process.execPath)}:$PATH"\n` +
        "    npm rebuild better-sqlite3 --build-from-source",
    );
    process.exit(1);
  }
}
