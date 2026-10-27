import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { newestSourceMtimeMs, productionSteps } from "./launchPlan.mjs";

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
