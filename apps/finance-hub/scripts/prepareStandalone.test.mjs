import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { prepareStandaloneAssets } from "./prepareStandalone.mjs";

test("standalone start copies static and public next to server.js", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fh-standalone-"));
  const standaloneDir = path.join(root, ".next", "standalone");
  fs.mkdirSync(path.join(standaloneDir, ".next"), { recursive: true });
  fs.writeFileSync(path.join(standaloneDir, "server.js"), "server");
  fs.writeFileSync(path.join(standaloneDir, "package.json"), '{"name":"finance-hub"}');
  fs.mkdirSync(path.join(root, ".next", "static", "chunks"), { recursive: true });
  fs.writeFileSync(path.join(root, ".next", "static", "chunks", "app.js"), "chunk");
  fs.mkdirSync(path.join(root, "public"), { recursive: true });
  fs.writeFileSync(path.join(root, "public", "favicon.ico"), "icon");
  const pkg = path.join(root, "node_modules", "better-sqlite3");
  fs.mkdirSync(path.join(pkg, "build", "Release"), { recursive: true });
  fs.writeFileSync(path.join(pkg, "package.json"), '{"name":"better-sqlite3"}');
  fs.writeFileSync(path.join(pkg, "build", "Release", "better_sqlite3.node"), "native");
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"finance-hub"}');

  const prepared = prepareStandaloneAssets(root);
  assert.equal(prepared.serverJs, path.join(standaloneDir, "server.js"));
  assert.equal(fs.readFileSync(path.join(standaloneDir, ".next", "static", "chunks", "app.js"), "utf8"), "chunk");
  assert.equal(fs.readFileSync(path.join(standaloneDir, "public", "favicon.ico"), "utf8"), "icon");
  assert.equal(
    fs.readFileSync(path.join(standaloneDir, "node_modules", "better-sqlite3", "build", "Release", "better_sqlite3.node"), "utf8"),
    "native",
  );
  assert.equal(fs.readFileSync(path.join(pkg, "build", "Release", "better_sqlite3.node"), "utf8"), "native");
  fs.rmSync(root, { recursive: true, force: true });
});

test("standalone start fails clearly when the build is missing", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fh-standalone-missing-"));
  assert.throws(() => prepareStandaloneAssets(root), /Missing .*server\.js/);
  fs.rmSync(root, { recursive: true, force: true });
});
