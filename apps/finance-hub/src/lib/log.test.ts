import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { APP_LOG_LINE_MAX_CHARS, APP_LOG_MAX_BYTES, appendAppLog, errorToLogText } from "./log";

describe("app log caps", () => {
  it("rotates past the cap and keeps a single backup", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-log-"));
    const logPath = path.join(dir, "app.log");
    try {
      fs.writeFileSync(logPath, "x".repeat(100));
      appendAppLog(logPath, "hello", 50);
      assert.equal(fs.readFileSync(`${logPath}.1`, "utf8"), "x".repeat(100));
      const current = fs.readFileSync(logPath, "utf8");
      assert.match(current, /hello/);
      assert.equal(current.includes("x".repeat(50)), false);

      fs.writeFileSync(logPath, "y".repeat(80));
      appendAppLog(logPath, "second", 50);
      assert.equal(fs.readFileSync(`${logPath}.1`, "utf8"), "y".repeat(80));
      assert.match(fs.readFileSync(logPath, "utf8"), /second/);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("does not rotate under the cap and clips each written line", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-log-"));
    const logPath = path.join(dir, "app.log");
    try {
      appendAppLog(logPath, "a", 10_000);
      appendAppLog(logPath, "b", 10_000);
      assert.equal(fs.existsSync(`${logPath}.1`), false);

      appendAppLog(logPath, `boom ${"z".repeat(5_000)}`, APP_LOG_MAX_BYTES);
      const lines = fs.readFileSync(logPath, "utf8").trim().split("\n");
      const last = lines[lines.length - 1] ?? "";
      const body = last.replace(/^\[[^\]]+\] /, "");
      assert.ok(body.length <= APP_LOG_LINE_MAX_CHARS);
      assert.ok(body.endsWith("..."));
      assert.equal(body.includes("z".repeat(500)), false);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("caps message plus stack and does not write token values", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-log-"));
    const logPath = path.join(dir, "app.log");
    try {
      const err = new Error(`access_token=super-secret-token ${"s".repeat(3_000)}`);
      appendAppLog(logPath, `schwab: ${errorToLogText(err)}`);
      const text = fs.readFileSync(logPath, "utf8");
      assert.equal(text.includes("super-secret-token"), false);
      assert.match(text, /access_token=\[redacted\]/);
      assert.ok(text.length < 500);
      assert.ok(APP_LOG_MAX_BYTES >= 5 * 1024 * 1024);
      assert.ok(APP_LOG_MAX_BYTES <= 10 * 1024 * 1024);
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
