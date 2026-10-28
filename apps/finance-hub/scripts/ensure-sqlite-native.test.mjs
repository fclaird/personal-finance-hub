import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";

import {
  ensureSqliteNative,
  npmBinForNode,
  npmCandidatesForNode,
  probeSqliteNative,
  sqliteRebuildCommand,
} from "./ensure-sqlite-native.mjs";

const armNode = "/Users/chris/.local/opt/node-v22.23.2-darwin-arm64/bin/node";
const armNpm = "/Users/chris/.local/opt/node-v22.23.2-darwin-arm64/bin/npm";
const intelNpm = "/usr/local/bin/npm";

test("npm is the one beside the arm64 Node, not /usr/local/bin/npm", () => {
  assert.deepEqual(npmCandidatesForNode(armNode, "/Users/chris"), [
    armNpm,
    "/Users/chris/.local/opt/node-arm64/bin/npm",
  ]);
  assert.equal(
    npmBinForNode(armNode, (candidate) => candidate === armNpm || candidate === intelNpm, "/Users/chris"),
    armNpm,
  );
  assert.notEqual(
    npmBinForNode(armNode, (candidate) => candidate === armNpm || candidate === intelNpm, "/Users/chris"),
    intelNpm,
  );
});

test("a successful require skips rebuild", () => {
  const calls = [];
  const result = ensureSqliteNative({
    nodeBin: armNode,
    appRoot: "/app",
    probe: () => {
      calls.push("probe");
      return { ok: true, resolved: "/app/node_modules/better-sqlite3/lib/index.js", error: "" };
    },
    spawnSync: () => {
      calls.push("rebuild");
      return { status: 0 };
    },
  });
  assert.equal(result.rebuilt, false);
  assert.deepEqual(calls, ["probe"]);
});

test("a failed require rebuilds with the arm64 npm and does not call prebuild-install", () => {
  const calls = [];
  let probes = 0;
  const result = ensureSqliteNative({
    nodeBin: armNode,
    appRoot: "/Applications/Finance Hub/apps/finance-hub",
    existsSync: (candidate) => candidate === armNpm,
    home: "/Users/chris",
    env: { PATH: `/usr/local/bin${path.delimiter}/usr/bin` },
    log() {},
    probe: () => {
      probes += 1;
      if (probes === 1) {
        return {
          ok: false,
          resolved: "/Applications/Finance Hub/apps/finance-hub/node_modules/better-sqlite3/lib/index.js",
          error: "Error: The module was compiled against a different Node.js version\nincompatible architecture",
        };
      }
      return {
        ok: true,
        resolved: "/Applications/Finance Hub/apps/finance-hub/node_modules/better-sqlite3/lib/index.js",
        error: "",
      };
    },
    spawnSync: (cmd, args, opts) => {
      calls.push({ cmd, args, cwd: opts.cwd, path: opts.env.PATH });
      return { status: 0 };
    },
  });
  assert.equal(result.rebuilt, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, armNpm);
  assert.deepEqual(calls[0].args, sqliteRebuildCommand());
  assert.equal(calls[0].cwd, "/Applications/Finance Hub/apps/finance-hub");
  assert.ok(calls[0].path.startsWith("/Users/chris/.local/opt/node-v22.23.2-darwin-arm64/bin"));
  assert.ok(!calls[0].path.startsWith("/usr/local/bin"));
  assert.equal(JSON.stringify(calls).includes("prebuild-install"), false);
});

test("this Node can require better-sqlite3 without a rebuild", () => {
  const appRoot = path.join(path.dirname(new URL(import.meta.url).pathname), "..");
  const probe = probeSqliteNative(process.execPath, appRoot);
  assert.equal(probe.ok, true, probe.error);
  assert.match(probe.resolved, /better-sqlite3/);
  const ensured = ensureSqliteNative({ nodeBin: process.execPath, appRoot, log() {} });
  assert.equal(ensured.rebuilt, false);
  assert.match(ensured.resolved, /better-sqlite3/);
});
