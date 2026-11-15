import assert from "node:assert/strict";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { listenTls } from "./localHttps.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

function freePort() {
  return new Promise((resolve, reject) => {
    const server = http.createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      const port = typeof addr === "object" && addr ? addr.port : 0;
      server.close(() => resolve(port));
    });
  });
}

function killGroup(pid, signal) {
  if (!pid) return;
  try {
    process.kill(-pid, signal);
  } catch {
    /* group already gone */
  }
  try {
    process.kill(pid, signal);
  } catch {
    /* process already gone */
  }
}

/**
 * Start scripts/start.mjs in its own process group and always tear the group down.
 * Killing only the parent used to leave `next start` running, and a parent that
 * ignored the first signal kept the test blocked.
 */
function runStart(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/start.mjs"], {
      cwd: root,
      detached: true,
      env: {
        ...process.env,
        FINANCE_HUB_BIND_HOST: "127.0.0.1",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const finish = (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(termTimer);
      clearTimeout(killTimer);
      killGroup(child.pid, "SIGKILL");
      resolve({ code, stdout, stderr });
    };
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    const termTimer = setTimeout(() => killGroup(child.pid, "SIGTERM"), 4_000);
    const killTimer = setTimeout(() => finish(null), 8_000);
    child.on("exit", (code) => finish(code));
    child.on("error", () => finish(null));
  });
}

describe("start protocol matches SCHWAB_REDIRECT_URI", () => {
  it("an https redirect refuses plain HTTP and names npm run dev when certs are missing", async () => {
    const port = await freePort();
    const result = await runStart({
      PORT: String(port),
      SCHWAB_REDIRECT_URI: `https://127.0.0.1:${port}/api/schwab/callback`,
      FINANCE_HUB_CERT_DIR: path.join(root, "certificates-missing-for-test"),
    });
    const combined = `${result.stdout}${result.stderr}`;
    assert.equal(result.code, 1);
    assert.match(combined, /Run: npm run dev/);
    assert.doesNotMatch(combined, /Finance Hub \(next start\) http:/);
  });

  it("an https redirect treats a healthy HTTPS port as already running", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-cert-"));
    const keyPath = path.join(dir, "localhost-key.pem");
    const certPath = path.join(dir, "localhost.pem");
    const made = spawnSync(
      "openssl",
      ["req", "-x509", "-newkey", "rsa:2048", "-keyout", keyPath, "-out", certPath, "-days", "1", "-nodes", "-subj", "/CN=127.0.0.1"],
      { encoding: "utf8" },
    );
    assert.equal(made.status, 0, made.stderr);
    const server = await listenTls({
      keyPath,
      certPath,
      host: "127.0.0.1",
      port: 0,
      onRequest(req, res) {
        if (req.url === "/api/health") {
          res.writeHead(200, { "content-type": "application/json" });
          res.end('{"ok":true}');
          return;
        }
        res.writeHead(404);
        res.end();
      },
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      const result = await runStart({
        PORT: String(port),
        SCHWAB_REDIRECT_URI: `https://127.0.0.1:${port}/api/schwab/callback`,
        FINANCE_HUB_CERT_DIR: dir,
      });
      const combined = `${result.stdout}${result.stderr}`;
      assert.equal(result.code, 0);
      assert.match(combined, new RegExp(`already running at https://127\\.0\\.0\\.1:${port}/`));
      assert.doesNotMatch(combined, /Finance Hub \(next start\) http:/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("an https redirect refuses a port that is already plain HTTP", async () => {
    const port = await freePort();
    const server = http.createServer((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    await new Promise((resolve) => server.listen(port, "127.0.0.1", resolve));
    try {
      const result = await runStart({
        PORT: String(port),
        SCHWAB_REDIRECT_URI: `https://127.0.0.1:${port}/api/schwab/callback`,
        FINANCE_HUB_CERT_DIR: path.join(root, "certificates-missing-for-test"),
      });
      const combined = `${result.stdout}${result.stderr}`;
      assert.equal(result.code, 1);
      assert.match(
        combined,
        new RegExp(
          `127\\.0\\.0\\.1:${port} is already speaking plain HTTP, but SCHWAB_REDIRECT_URI is https://127\\.0\\.0\\.1:${port}/api/schwab/callback`,
        ),
      );
      assert.match(combined, /Stop that process, then run: npm start/);
      assert.doesNotMatch(combined, /Finance Hub \(next start\) http:/);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("an http redirect still starts plain HTTP", async () => {
    const port = await freePort();
    const result = await runStart({
      PORT: String(port),
      SCHWAB_REDIRECT_URI: `http://127.0.0.1:${port}/api/schwab/callback`,
    });
    const combined = `${result.stdout}${result.stderr}`;
    assert.match(combined, new RegExp(`Finance Hub \\(next start\\) http://127\\.0\\.0\\.1:${port}/`));
    assert.doesNotMatch(combined, /Refusing to start/);
  });
});
