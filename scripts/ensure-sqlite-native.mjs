#!/usr/bin/env node
/**
 * Fail fast when better-sqlite3 was built for a different CPU arch than this Node binary.
 * Common on Apple Silicon when `npm install` used arm64 Node but `npm run dev` uses Homebrew x64 Node.
 */
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(path.join(root, "package.json"));

function loadSqlite() {
  const Database = require("better-sqlite3");
  const db = new Database(":memory:");
  db.close();
}

try {
  loadSqlite();
  process.exit(0);
} catch (e) {
  const msg = e instanceof Error ? e.message : String(e);
  if (!msg.includes("incompatible architecture")) {
    console.error("[finance-hub] better-sqlite3 failed to load:", msg);
    process.exit(1);
  }

  console.warn(
    `[finance-hub] Rebuilding better-sqlite3 for Node ${process.version} (${process.arch})…`,
  );
  process.env.npm_config_build_from_source = "true";
  try {
    execSync("npm rebuild better-sqlite3", { stdio: "inherit", cwd: root });
    loadSqlite();
    console.warn("[finance-hub] better-sqlite3 rebuild OK.");
    process.exit(0);
  } catch (rebuildErr) {
    console.error(
      "[finance-hub] better-sqlite3 architecture mismatch.\n" +
        `  Node: ${process.version} (${process.arch})\n` +
        "  Fix: use one Node install for install and dev, then run:\n" +
        "    npm run rebuild:sqlite\n" +
        "  On Apple Silicon with Homebrew x64 Node, try:\n" +
        "    arch -x86_64 npm run rebuild:sqlite\n" +
        "  Or run dev with native arm64 Node (fnm/nvm) instead of /usr/local Homebrew x64.",
    );
    console.error(rebuildErr instanceof Error ? rebuildErr.message : rebuildErr);
    process.exit(1);
  }
}
