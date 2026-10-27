import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveFinanceHubNode } from "./resolveNode.mjs";

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
