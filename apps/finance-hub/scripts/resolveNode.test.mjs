import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  canonicalNodePath,
  nodeVersionAcceptable,
  reexecFinanceHubNode,
  resolveFinanceHubNode,
  sameNodeBinary,
  shouldReexecFinanceHubNode,
} from "./resolveNode.mjs";

test("FINANCE_HUB_NODE wins when the file exists", () => {
  const bin = process.execPath;
  assert.equal(
    resolveFinanceHubNode({
      env: { FINANCE_HUB_NODE: bin },
      platform: "linux",
      execPath: "/usr/bin/false-node",
    }),
    bin,
  );
});

test("darwin prefers the home arm64 install and falls back to the current binary", () => {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "fh-node-"));
  const installed = path.join(home, ".local", "opt", "node-arm64", "bin", "node");
  fs.mkdirSync(path.dirname(installed), { recursive: true });
  fs.writeFileSync(installed, "");
  const seen = [];
  const resolved = resolveFinanceHubNode({
    env: {},
    platform: "darwin",
    home,
    execPath: "/usr/local/bin/node",
    archOf: (bin) => {
      seen.push(bin);
      return bin === installed ? "arm64" : null;
    },
  });
  assert.equal(resolved, installed);
  assert.equal(seen[0], installed);

  const fallback = resolveFinanceHubNode({
    env: {},
    platform: "darwin",
    home: path.join(home, "missing"),
    execPath: "/usr/local/bin/node",
    archOf: () => null,
  });
  assert.equal(fallback, "/usr/local/bin/node");
});

test("non-mac hosts keep the current Node", () => {
  assert.equal(
    resolveFinanceHubNode({
      env: {},
      platform: "linux",
      execPath: "/usr/bin/node",
      archOf: () => "arm64",
    }),
    "/usr/bin/node",
  );
});

test("Node 20.9 and newer is acceptable; older 20 is not", () => {
  assert.equal(nodeVersionAcceptable("v22.23.2"), true);
  assert.equal(nodeVersionAcceptable("v20.9.0"), true);
  assert.equal(nodeVersionAcceptable("v20.8.9"), false);
  assert.equal(nodeVersionAcceptable("v18.20.0"), false);
});

test("a symlink to the running Node does not re-exec", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-node-link-"));
  const real = path.join(dir, "node-v22.23.2-darwin-arm64", "bin", "node");
  fs.mkdirSync(path.dirname(real), { recursive: true });
  fs.writeFileSync(real, "");
  const link = path.join(dir, "node-arm64", "bin", "node");
  fs.mkdirSync(path.dirname(link), { recursive: true });
  fs.symlinkSync(real, link);

  assert.notEqual(path.resolve(link), path.resolve(real));
  assert.equal(canonicalNodePath(link), canonicalNodePath(real));
  assert.equal(sameNodeBinary(link, real), true);
  assert.equal(
    shouldReexecFinanceHubNode({
      env: { FINANCE_HUB_NODE: link },
      platform: "darwin",
      arch: "x64",
      version: "v22.23.2",
      execPath: real,
    }),
    null,
  );

  fs.rmSync(dir, { recursive: true, force: true });
});

test("arm64 with an acceptable version does not re-exec onto another path", () => {
  assert.equal(
    shouldReexecFinanceHubNode({
      env: { FINANCE_HUB_NODE: "/no/such/node" },
      platform: "darwin",
      arch: "arm64",
      version: "v22.23.2",
      execPath: "/usr/local/bin/node",
    }),
    null,
  );
});

test("FINANCE_HUB_REEXEC=1 never re-execs, and a real re-exec sets that flag once", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-node-reexec-"));
  const target = path.join(dir, "node-v22.23.2-darwin-arm64", "bin", "node");
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, "");
  const wrapper = path.join(dir, "node-arm64", "bin", "node");
  fs.mkdirSync(path.dirname(wrapper), { recursive: true });
  fs.symlinkSync(target, wrapper);
  const rosetta = path.join(dir, "usr-local", "bin", "node");
  fs.mkdirSync(path.dirname(rosetta), { recursive: true });
  fs.writeFileSync(rosetta, "");

  const calls = [];
  const spawned = reexecFinanceHubNode(["scripts/start.mjs"], {
    env: { FINANCE_HUB_NODE: wrapper },
    platform: "darwin",
    arch: "x64",
    version: "v22.23.4",
    execPath: rosetta,
    spawn: (bin, args, opts) => {
      calls.push({ bin, args, env: opts.env });
      return { on() {} };
    },
  });
  assert.equal(spawned, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].bin, target);
  assert.deepEqual(calls[0].args, ["scripts/start.mjs"]);
  assert.equal(calls[0].env.FINANCE_HUB_REEXEC, "1");
  assert.equal(calls[0].env.FINANCE_HUB_NODE, target);

  assert.equal(
    shouldReexecFinanceHubNode({
      env: calls[0].env,
      platform: "darwin",
      arch: "x64",
      version: "v18.0.0",
      execPath: rosetta,
    }),
    null,
  );
  fs.rmSync(dir, { recursive: true, force: true });
});
