import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  backupSqliteNative,
  copySqliteNativeIntoStandalone,
  probeStandaloneSqlite,
  restoreSqliteNative,
  sqlitePackageDir,
} from "./sqliteStandalone.mjs";

const appRoot = path.join(path.dirname(new URL(import.meta.url).pathname), "..");

function copyPackage(src, dest) {
  fs.cpSync(src, dest, { recursive: true, dereference: true });
}

test("backup copies the native addon and does not remove build/", () => {
  const pkg = sqlitePackageDir(appRoot);
  assert.ok(pkg);
  const nodeFile = path.join(pkg, "build", "Release", "better_sqlite3.node");
  assert.equal(fs.existsSync(nodeFile), true);
  const before = fs.statSync(nodeFile);
  const backupDir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-sqlite-backup-"));
  const copied = backupSqliteNative(pkg, backupDir);
  assert.ok(copied.some((file) => file.endsWith("better_sqlite3.node")));
  const after = fs.statSync(nodeFile);
  assert.equal(after.ino, before.ino);
  assert.equal(fs.statSync(nodeFile).size, before.size);
  fs.rmSync(backupDir, { recursive: true, force: true });
});

test("a missing build/ is restored from the copy and the backup is kept", () => {
  const realPkg = sqlitePackageDir(appRoot);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fh-sqlite-restore-"));
  const pkg = path.join(root, "better-sqlite3");
  copyPackage(realPkg, pkg);
  const backupDir = path.join(root, "backup");
  backupSqliteNative(pkg, backupDir);
  fs.rmSync(path.join(pkg, "build"), { recursive: true, force: true });
  assert.equal(fs.existsSync(path.join(pkg, "build", "Release", "better_sqlite3.node")), false);
  const restored = restoreSqliteNative(pkg, backupDir);
  assert.ok(restored.some((file) => file.endsWith(`${path.sep}build${path.sep}Release${path.sep}better_sqlite3.node`)));
  assert.equal(fs.existsSync(path.join(backupDir, "build", "Release", "better_sqlite3.node")), true);
  fs.rmSync(root, { recursive: true, force: true });
});

test("standalone bundle require('better-sqlite3') loads the copied native addon", () => {
  const realPkg = sqlitePackageDir(appRoot);
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fh-standalone-sqlite-"));
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"finance-hub"}\n');
  copyPackage(realPkg, path.join(root, "node_modules", "better-sqlite3"));

  const standalone = path.join(root, ".next", "standalone");
  fs.mkdirSync(standalone, { recursive: true });
  fs.writeFileSync(path.join(standalone, "server.js"), "server");
  fs.writeFileSync(path.join(standalone, "package.json"), '{"name":"finance-hub"}\n');
  const traced = path.join(standalone, "node_modules", "better-sqlite3");
  copyPackage(realPkg, traced);
  fs.rmSync(path.join(traced, "build"), { recursive: true, force: true });
  for (const dep of ["bindings", "file-uri-to-path"]) {
    copyPackage(path.join(appRoot, "node_modules", dep), path.join(standalone, "node_modules", dep));
  }

  const sourceNode = path.join(root, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node");
  const sourceIno = fs.statSync(sourceNode).ino;
  const copied = copySqliteNativeIntoStandalone(root);
  assert.ok(copied.some((file) => file.includes(`${path.sep}.next${path.sep}standalone${path.sep}`)));
  assert.equal(fs.statSync(sourceNode).ino, sourceIno);
  assert.equal(
    fs.existsSync(path.join(traced, "build", "Release", "better_sqlite3.node")),
    true,
  );

  const probe = probeStandaloneSqlite(process.execPath, standalone);
  assert.equal(probe.ok, true, probe.error);
  assert.match(probe.resolved, /\.next[\\/]standalone[\\/].*better-sqlite3/);

  const outside = spawnSync(
    process.execPath,
    ["-e", "process.stdout.write(require.resolve('better-sqlite3'))"],
    { cwd: standalone, encoding: "utf8", env: { ...process.env, NODE_PATH: "" } },
  );
  assert.equal(outside.status, 0, outside.stderr);
  assert.match(outside.stdout, /\.next[\\/]standalone[\\/]/);
  fs.rmSync(root, { recursive: true, force: true });
});
