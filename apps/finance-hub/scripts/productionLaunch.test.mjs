import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { selectHubPids } from "./hubProcesses.mjs";
import {
  INTEL_NODE,
  backupNextDir,
  ensureProductionBuild,
  formatBuildStamp,
  needsRebuild,
  productionPath,
  readBuildStamp,
  resolveProductionNode,
  restoreNextDir,
} from "./productionLaunch.mjs";

describe("production node", () => {
  it("uses /usr/local/bin/node on darwin only when it is x64", () => {
    assert.equal(
      resolveProductionNode({
        platform: "darwin",
        exists: (file) => file === INTEL_NODE,
        archOf: () => "x64",
      }),
      INTEL_NODE,
    );
    assert.throws(
      () =>
        resolveProductionNode({
          platform: "darwin",
          exists: () => true,
          archOf: () => "arm64",
        }),
      /x64/,
    );
    assert.equal(
      resolveProductionNode({
        platform: "linux",
        env: { FINANCE_HUB_NODE: "/opt/node" },
        execPath: "/usr/bin/node",
      }),
      "/opt/node",
    );
  });
});

describe("production PATH", () => {
  it("puts /usr/local/bin first without dropping the rest", () => {
    assert.equal(productionPath("/usr/bin:/bin"), "/usr/local/bin:/usr/bin:/bin");
    assert.equal(productionPath("/usr/local/bin:/usr/bin"), "/usr/local/bin:/usr/bin");
    assert.equal(productionPath(""), "/usr/local/bin");
  });
});

describe("build stamp", () => {
  it("skips a rebuild when HEAD and the lockfile match a finished build", () => {
    const current = { head: "abc", lock: "def" };
    assert.equal(needsRebuild(readBuildStamp(formatBuildStamp(current)), current, true), false);
    assert.equal(needsRebuild(readBuildStamp(formatBuildStamp(current)), { head: "abc", lock: "fff" }, true), true);
    assert.equal(needsRebuild(null, current, false), true);
  });

  it("keeps the last good build when next build fails", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-build-"));
    const nextDir = path.join(dir, ".next");
    const backupDir = path.join(dir, ".next-last-good");
    fs.mkdirSync(nextDir);
    fs.writeFileSync(path.join(nextDir, "BUILD_ID"), "good");
    let builds = 0;
    const result = ensureProductionBuild({
      current: { head: "new", lock: "lock" },
      saved: { head: "old", lock: "lock" },
      hasBuild: () => fs.existsSync(path.join(nextDir, "BUILD_ID")),
      backup: () => {
        backupNextDir(nextDir, backupDir);
        return true;
      },
      restore: () => restoreNextDir(nextDir, backupDir),
      runBuild: () => {
        builds += 1;
        fs.rmSync(nextDir, { recursive: true, force: true });
        throw new Error("compile failed");
      },
      writeStamp: () => {
        throw new Error("should not stamp a failed build");
      },
    });
    assert.equal(result.action, "kept-last-good");
    assert.equal(builds, 1);
    assert.equal(fs.readFileSync(path.join(nextDir, "BUILD_ID"), "utf8"), "good");
    fs.rmSync(dir, { recursive: true, force: true });
  });

  it("does not run the build when the stamp matches", () => {
    let builds = 0;
    const result = ensureProductionBuild({
      current: { head: "abc", lock: "def" },
      saved: { head: "abc", lock: "def" },
      hasBuild: () => true,
      backup: () => false,
      restore: () => false,
      runBuild: () => {
        builds += 1;
      },
      writeStamp: () => {},
    });
    assert.equal(result.action, "skip");
    assert.equal(builds, 0);
  });
});

describe("stale hub processes", () => {
  const root = "/Users/chris/Projects/personal-finance-hub/apps/finance-hub";

  it("kills the hub on port 3000 and a next dev launched from this repo, not other node processes", () => {
    const pids = selectHubPids(
      [
        { pid: 1, command: "launchd", cwd: "/", ports: [] },
        { pid: 50, command: "node /usr/local/bin/npm", cwd: "/tmp", ports: [] },
        { pid: 51, command: "node /opt/other/server.js", cwd: "/opt/other", ports: [3001] },
        {
          pid: 19040,
          command: `node ${root}/node_modules/next/dist/bin/next dev`,
          cwd: "/private/tmp/next-wrapper",
          ports: [],
        },
        { pid: 19067, command: "next-server (v16.2.4)", cwd: root, ports: [3000] },
        { pid: 77, command: "node scripts/start.mjs", cwd: root, ports: [] },
      ],
      { selfPid: 10, root, port: 3000 },
    );
    assert.deepEqual(pids.sort((a, b) => a - b), [77, 19040, 19067]);
  });
});
