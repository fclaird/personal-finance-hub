#!/usr/bin/env node
/**
 * Fail fast when better-sqlite3 was built for a different CPU arch than this Node binary.
 * Common on Apple Silicon when `npm install` used arm64 Node but `npm run dev` uses Homebrew x64 Node.
 */
import { execSync, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));

function resolveNpmBin() {
  const fromPath = spawnSync("command", ["-v", "npm"], {
    encoding: "utf8",
    shell: true,
  }).stdout?.trim();
  if (fromPath && fs.existsSync(fromPath)) return fromPath;

  for (const candidate of ["/opt/homebrew/bin/npm", "/usr/local/bin/npm"]) {
    if (fs.existsSync(candidate)) return candidate;
  }

  const sibling = path.join(path.dirname(process.execPath), process.platform === "win32" ? "npm.cmd" : "npm");
  if (fs.existsSync(sibling)) return sibling;

  return "npm";
}

const npmBin = resolveNpmBin();

function rebuildSqliteNative() {
  const sqliteDir = path.join(root, "node_modules/better-sqlite3");
  fs.rmSync(path.join(sqliteDir, "build"), { recursive: true, force: true });
  fs.rmSync(path.join(sqliteDir, "compiled"), { recursive: true, force: true });
  const prebuild = path.join(root, "node_modules/prebuild-install/bin.js");
  execSync(`"${process.execPath}" "${prebuild}"`, {
    stdio: "inherit",
    cwd: sqliteDir,
  });
}

function loadSqlite() {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  db.close();
}

try {
  loadSqlite();
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (!msg.includes("incompatible architecture") && !msg.includes("Could not locate the bindings file")) {
    console.error("[finance-hub] better-sqlite3 failed to load:", msg);
    process.exit(1);
  }

  console.warn(
    `[finance-hub] Rebuilding better-sqlite3 for Node ${process.version} (${process.arch})…`,
  );
  process.env.npm_config_build_from_source = "true";
  try {
    rebuildSqliteNative();
    loadSqlite();
    console.warn("[finance-hub] better-sqlite3 rebuild OK.");
  } catch (rebuildErr) {
    console.error(
      "[finance-hub] better-sqlite3 architecture mismatch.\n" +
        `  Node: ${process.version} (${process.arch})\n` +
        "  Fix: use one Node install for install and dev, then run:\n" +
        "    npm run rebuild:sqlite\n" +
        "  Or reinstall deps with the same Node you use for dev:\n" +
        "    rm -rf node_modules && npm install",
    );
    console.error(rebuildErr instanceof Error ? rebuildErr.message : rebuildErr);
    process.exit(1);
  }
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
  console.warn(
    `[finance-hub] Installing ${platformPkg}@${version} for Node ${process.version} (${process.arch})…`,
  );
  try {
    execSync(`"${npmBin}" install ${platformPkg}@${version} --force`, {
      stdio: "inherit",
      cwd: root,
    });
    loadFn();
    console.warn(`[finance-hub] ${pkgName} native module OK.`);
  } catch (installErr) {
    console.error(
      `[finance-hub] ${pkgName} native module missing.\n` +
        `  Node: ${process.version} (${process.arch})\n` +
        `  Fix: npm install ${platformPkg}@${version} --force`,
    );
    console.error(installErr instanceof Error ? installErr.message : installErr);
    process.exit(1);
  }
}

ensureOptionalNative("lightningcss", () => {
  require("lightningcss");
});
ensureOptionalNative("@tailwindcss/oxide", () => {
  require("@tailwindcss/oxide");
});
process.exit(0);
