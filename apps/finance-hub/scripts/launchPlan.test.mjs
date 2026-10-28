import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { launchActions, newestSourceMtimeMs, productionSteps } from "./launchPlan.mjs";

test("production launch builds when there is no BUILD_ID or sources are newer", () => {
  assert.deepEqual(productionSteps({ mode: "prod", rebuild: false, buildIdMtimeMs: null, newestSourceMtimeMs: 10 }), [
    "build",
    "start",
  ]);
  assert.deepEqual(productionSteps({ mode: "prod", rebuild: false, buildIdMtimeMs: 5, newestSourceMtimeMs: 10 }), [
    "build",
    "start",
  ]);
  assert.deepEqual(productionSteps({ mode: "prod", rebuild: true, buildIdMtimeMs: 20, newestSourceMtimeMs: 10 }), [
    "build",
    "start",
  ]);
  assert.deepEqual(productionSteps({ mode: "prod", rebuild: false, buildIdMtimeMs: 20, newestSourceMtimeMs: 10 }), [
    "start",
  ]);
});

test("port 3000 is stopped only after a staged health check", () => {
  assert.deepEqual(launchActions(["build", "start"]), [
    "ensure-native",
    "backup-native",
    "build",
    "restore-native",
    "stage-start",
    "health-gate",
    "promote-start",
  ]);
  assert.deepEqual(launchActions(["start"]), ["ensure-native", "stage-start", "health-gate", "promote-start"]);
  assert.deepEqual(launchActions(["dev"]), ["ensure-native", "kill-port", "dev"]);
  const prod = launchActions(["build", "start"]);
  assert.ok(prod.indexOf("restore-native") < prod.indexOf("stage-start"));
  assert.ok(prod.indexOf("health-gate") < prod.indexOf("promote-start"));
  assert.equal(prod.includes("kill-port"), false);
});

test("dev and start skip the production build", () => {
  assert.deepEqual(productionSteps({ mode: "dev", rebuild: true, buildIdMtimeMs: null, newestSourceMtimeMs: 1 }), ["dev"]);
  assert.deepEqual(productionSteps({ mode: "start", rebuild: true, buildIdMtimeMs: null, newestSourceMtimeMs: 1 }), [
    "start",
  ]);
  assert.throws(() => productionSteps({ mode: "nope", rebuild: false, buildIdMtimeMs: 1, newestSourceMtimeMs: 1 }), /Unknown launch mode/);
});

test("newest source mtime sees files under src", () => {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), "fh-launch-"));
  fs.mkdirSync(path.join(root, "src"), { recursive: true });
  const file = path.join(root, "src", "page.tsx");
  fs.writeFileSync(file, "export {}\n");
  const mtime = newestSourceMtimeMs(root);
  assert.equal(mtime, fs.statSync(file).mtimeMs);
});
