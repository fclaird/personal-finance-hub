import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  appendDevLog,
  collectRestartPids,
  createDevWatchdog,
  planRestart,
  rotateOwnedLog,
  watchdogEnabled,
  watchdogFailureBudget,
  watchdogGraceMs,
} from "./devWatchdog.mjs";

describe("dev watchdog", () => {
  it("stays off unless FINANCE_HUB_DEV_WATCHDOG is exactly 1", () => {
    assert.equal(watchdogEnabled({}), false);
    assert.equal(watchdogEnabled({ FINANCE_HUB_DEV_WATCHDOG: "true" }), false);
    assert.equal(watchdogEnabled({ FINANCE_HUB_DEV_WATCHDOG: "0" }), false);
    assert.equal(watchdogEnabled({ FINANCE_HUB_DEV_WATCHDOG: "1" }), true);
    assert.equal(watchdogFailureBudget({}), 3);
    assert.equal(watchdogFailureBudget({ FINANCE_HUB_DEV_WATCHDOG_MINUTES: "5" }), 5);
    assert.equal(watchdogFailureBudget({ FINANCE_HUB_DEV_WATCHDOG_MINUTES: "0" }), 3);
    assert.equal(watchdogGraceMs({}), 120_000);
  });

  it("refuses to signal any pid that is not the spawned child in this repo", () => {
    assert.deepEqual(planRestart({ pid: 1, cwd: "/app", root: "/app", selfPid: 9 }), {
      ok: false,
      reason: "no_child",
    });
    assert.equal(planRestart({ pid: 9, cwd: "/app", root: "/app", selfPid: 9 }).ok, false);
    assert.equal(planRestart({ pid: 42, cwd: "/elsewhere", root: "/app", selfPid: 9 }).reason, "cwd");
    assert.equal(planRestart({ pid: 42, cwd: "/app", root: "/app", selfPid: 9 }).ok, true);
  });

  it("collects only descendants, children first", () => {
    const children = new Map([
      [10, [11, 12]],
      [11, [13]],
      [12, []],
      [13, []],
      [99, [10]],
    ]);
    assert.deepEqual(
      collectRestartPids(10, (pid) => children.get(pid) ?? [], 99),
      [13, 11, 12, 10],
    );
    assert.deepEqual(collectRestartPids(99, (pid) => children.get(pid) ?? [], 99), []);
  });

  it("kills only the spawned tree after N failed health probes", async () => {
    const killed = [];
    let probes = 0;
    const dog = createDevWatchdog({
      failureBudget: 3,
      graceMs: 0,
      root: "/hub",
      selfPid: 1,
      log() {},
      probe: async () => {
        probes += 1;
        return false;
      },
      childPid: () => 50,
      cwdOf: () => "/hub",
      listChildren: (pid) => (pid === 50 ? [51] : []),
      killTree: (pids) => killed.push(pids),
      onRestart: async () => {},
    });
    dog.noteSpawn(0);
    assert.equal((await dog.tick(10_000)).action, "wait");
    assert.equal((await dog.tick(70_000)).action, "wait");
    assert.deepEqual(killed, []);
    const restarted = await dog.tick(130_000);
    assert.equal(restarted.action, "restarted");
    assert.deepEqual(killed, [[51, 50]]);
    assert.equal(probes, 3);
  });

  it("does not probe or kill during the grace window, or when cwd does not match", async () => {
    let probed = false;
    let killed = false;
    const dog = createDevWatchdog({
      failureBudget: 1,
      graceMs: 60_000,
      root: "/hub",
      selfPid: 1,
      log() {},
      probe: async () => {
        probed = true;
        return false;
      },
      childPid: () => 77,
      cwdOf: () => "/not-the-hub",
      listChildren: () => [],
      killTree: () => {
        killed = true;
      },
      onRestart: async () => {},
    });
    assert.equal((await dog.tick(1_000)).action, "grace");
    assert.equal(probed, false);
    dog.noteSpawn(0);
    assert.equal((await dog.tick(120_000)).action, "refused");
    assert.equal(killed, false);
  });

  it("rotates the dev log in place and appends watchdog lines", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-devlog-"));
    const logPath = path.join(dir, "dev.log");
    try {
      fs.writeFileSync(logPath, "x".repeat(100));
      assert.equal(rotateOwnedLog(logPath, 50), true);
      assert.equal(fs.readFileSync(`${logPath}.1`, "utf8"), "x".repeat(100));
      assert.equal(fs.readFileSync(logPath, "utf8"), "");
      appendDevLog(logPath, "restarting next-server pids=51,50");
      assert.match(fs.readFileSync(logPath, "utf8"), /\[dev-watchdog\] restarting next-server pids=51,50/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
