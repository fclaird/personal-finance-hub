import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

/**
 * Next's standalone trace copies better-sqlite3's JS but not the native
 * addon. `bindings` then looks for build/Release/better_sqlite3.node (and the
 * compiled/ and lib/binding/ fallbacks) inside that copy and /api/health 500s.
 * node-gyp's rebuild also deletes build/ before it compiles. Copy the .node
 * file. Never rename or delete the source build/.
 */

const SQLITE_PROBE = `
const { createRequire } = require("module");
const path = require("path");
const serverDir = process.argv[1];
const req = createRequire(path.join(serverDir, "package.json"));
const resolved = req.resolve("better-sqlite3");
const root = fsReal(serverDir);
const hit = fsReal(resolved);
if (hit !== root && !hit.startsWith(root + path.sep)) {
  console.error("better-sqlite3 resolved outside the standalone dir: " + resolved);
  process.exit(2);
}
const Database = req("better-sqlite3");
const db = new Database(":memory:");
db.close();
process.stdout.write(resolved);
function fsReal(p) {
  const fs = require("fs");
  try { return fs.realpathSync(p); } catch { return path.resolve(p); }
}
`;

export function sqliteBackupDir(appRoot) {
  return path.join(appRoot, "node_modules", ".cache", "finance-hub-sqlite-native");
}

export function sqlitePackageDir(appRoot) {
  try {
    const req = createRequire(path.join(appRoot, "package.json"));
    return path.dirname(req.resolve("better-sqlite3/package.json"));
  } catch {
    const direct = path.join(appRoot, "node_modules", "better-sqlite3");
    if (fs.existsSync(path.join(direct, "package.json"))) return direct;
    return null;
  }
}

export function listSqliteNodeFiles(pkgDir) {
  const buildDir = path.join(pkgDir, "build");
  if (!fs.existsSync(buildDir)) return [];
  const out = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(".node")) out.push(abs);
    }
  };
  walk(buildDir);
  return out;
}

/** Copy .node files out of the package. Does not remove or rename build/. */
export function backupSqliteNative(pkgDir, backupDir) {
  const files = listSqliteNodeFiles(pkgDir);
  for (const file of files) {
    const dest = path.join(backupDir, path.relative(pkgDir, file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
  }
  return files;
}

export function restoreSqliteNative(pkgDir, backupDir) {
  if (!fs.existsSync(backupDir)) return [];
  const restored = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const abs = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(abs);
      else if (entry.isFile() && entry.name.endsWith(".node")) {
        const dest = path.join(pkgDir, path.relative(backupDir, abs));
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.copyFileSync(abs, dest);
        restored.push(dest);
      }
    }
  };
  walk(backupDir);
  return restored;
}

export function backupAppSqliteNative(appRoot) {
  const pkgDir = sqlitePackageDir(appRoot);
  if (!pkgDir) return [];
  return backupSqliteNative(pkgDir, sqliteBackupDir(appRoot));
}

export function restoreAppSqliteNativeIfMissing(appRoot) {
  const pkgDir = sqlitePackageDir(appRoot);
  if (!pkgDir) return [];
  if (listSqliteNodeFiles(pkgDir).length > 0) return [];
  const restored = restoreSqliteNative(pkgDir, sqliteBackupDir(appRoot));
  if (restored.length > 0) {
    console.warn(
      `[finance-hub] Restored ${restored.length} better-sqlite3 native file(s) into ${pkgDir}. build/ was missing after the build; the backup was a copy, not a move.`,
    );
  }
  return restored;
}

function walkServerDirs(dir, depth, out) {
  if (depth > 4) return;
  if (fs.existsSync(path.join(dir, "server.js"))) out.push(dir);
  let entries = [];
  try {
    entries = fs.readdirSync(dir, { withFileTypes: true });
  } catch {
    return;
  }
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === "node_modules" || entry.name === ".next") continue;
    walkServerDirs(path.join(dir, entry.name), depth + 1, out);
  }
}

export function standaloneServerDirs(standaloneDir) {
  const out = [];
  if (fs.existsSync(standaloneDir)) walkServerDirs(standaloneDir, 0, out);
  return out;
}

export function findStandaloneSqlitePackages(standaloneDir) {
  const found = [];
  const seen = new Set();
  const stack = [standaloneDir];
  while (stack.length > 0) {
    const dir = stack.pop();
    if (!dir || seen.has(dir)) continue;
    seen.add(dir);
    const candidate = path.join(dir, "node_modules", "better-sqlite3");
    if (fs.existsSync(path.join(candidate, "package.json"))) found.push(candidate);
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (!entry.isDirectory() || entry.name === "node_modules") continue;
      if (dir === standaloneDir || entry.name === "apps" || entry.name === ".next") {
        stack.push(path.join(dir, entry.name));
      }
    }
  }
  return found;
}

function copyNodeFiles(pkgDir, destPkg) {
  const copied = [];
  for (const file of listSqliteNodeFiles(pkgDir)) {
    const dest = path.join(destPkg, path.relative(pkgDir, file));
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(file, dest);
    copied.push(dest);
  }
  return copied;
}

/**
 * Put build/Release/*.node into every standalone copy of better-sqlite3.
 * If the trace omitted the package entirely, copy the package into standalone
 * node_modules. The source build/ directory is only read.
 */
export function copySqliteNativeIntoStandalone(appRoot) {
  const pkgDir = sqlitePackageDir(appRoot);
  const standaloneDir = path.join(appRoot, ".next", "standalone");
  if (!pkgDir) {
    throw new Error(`better-sqlite3 is not installed under ${appRoot}`);
  }
  const nodeFiles = listSqliteNodeFiles(pkgDir);
  if (nodeFiles.length === 0) {
    throw new Error(
      `better-sqlite3 has no build/**/*.node under ${pkgDir}. Refusing to start a standalone server that cannot load sqlite.`,
    );
  }
  if (!fs.existsSync(path.join(standaloneDir, "server.js")) && standaloneServerDirs(standaloneDir).length === 0) {
    throw new Error(`Missing ${path.join(standaloneDir, "server.js")}. Build first.`);
  }

  let packages = findStandaloneSqlitePackages(standaloneDir);
  if (packages.length === 0) {
    for (const serverDir of standaloneServerDirs(standaloneDir)) {
      const dest = path.join(serverDir, "node_modules", "better-sqlite3");
      fs.cpSync(pkgDir, dest, { recursive: true, dereference: true });
      packages.push(dest);
    }
  }

  const copied = [];
  for (const destPkg of packages) {
    copied.push(...copyNodeFiles(pkgDir, destPkg));
  }
  if (copied.length === 0) {
    throw new Error(`Standalone bundle has no better-sqlite3 package under ${standaloneDir}`);
  }
  return copied;
}

export function copySchemaBesideStandaloneServers(appRoot) {
  const schema = path.join(appRoot, "src", "db", "schema.sql");
  if (!fs.existsSync(schema)) return [];
  const copied = [];
  for (const serverDir of standaloneServerDirs(path.join(appRoot, ".next", "standalone"))) {
    const dest = path.join(serverDir, "src", "db", "schema.sql");
    fs.mkdirSync(path.dirname(dest), { recursive: true });
    fs.copyFileSync(schema, dest);
    copied.push(dest);
  }
  return copied;
}

export function probeStandaloneSqlite(nodeBin, serverDir, spawnFn = spawnSync) {
  const result = spawnFn(nodeBin, ["-e", SQLITE_PROBE, serverDir], {
    cwd: serverDir,
    encoding: "utf8",
    env: { ...process.env, NODE_PATH: "" },
  });
  const error = `${result.stderr || ""}${result.error ? result.error.message : ""}`.trim();
  return {
    ok: result.status === 0,
    resolved: (result.stdout || "").trim(),
    error,
  };
}

function main() {
  const appRoot = process.argv[3]
    ? path.resolve(process.argv[3])
    : path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
  const cmd = process.argv[2];
  if (cmd === "backup") {
    const files = backupAppSqliteNative(appRoot);
    if (files.length === 0) {
      console.error(`[finance-hub] No better_sqlite3.node to back up under ${appRoot}`);
      process.exit(1);
    }
    console.warn(`[finance-hub] Copied ${files.length} sqlite native file(s) to ${sqliteBackupDir(appRoot)}`);
    return;
  }
  if (cmd === "restore") {
    const restored = restoreAppSqliteNativeIfMissing(appRoot);
    if (restored.length === 0) {
      console.warn("[finance-hub] better-sqlite3 build/ is still present; nothing restored.");
    }
    return;
  }
  console.error("Usage: node scripts/sqliteStandalone.mjs backup|restore [appRoot]");
  process.exit(1);
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) main();
