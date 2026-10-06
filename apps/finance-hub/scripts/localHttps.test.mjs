import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import https from "node:https";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { listenTls } from "./localHttps.mjs";

function writeCert(dir) {
  const keyPath = path.join(dir, "localhost-key.pem");
  const certPath = path.join(dir, "localhost.pem");
  const result = spawnSync(
    "openssl",
    [
      "req",
      "-x509",
      "-newkey",
      "rsa:2048",
      "-keyout",
      keyPath,
      "-out",
      certPath,
      "-days",
      "1",
      "-nodes",
      "-subj",
      "/CN=127.0.0.1",
      "-addext",
      "subjectAltName=IP:127.0.0.1",
    ],
    { encoding: "utf8" },
  );
  assert.equal(result.status, 0, result.stderr);
  return { keyPath, certPath };
}

function httpGet(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/api/health", timeout: 2000 }, (res) => {
      res.resume();
      resolve({ error: null, status: res.statusCode });
    });
    req.on("error", (error) => resolve({ error, status: 0 }));
    req.on("timeout", () => {
      req.destroy();
      resolve({ error: new Error("timeout"), status: 0 });
    });
  });
}

function httpsGet(port) {
  return new Promise((resolve, reject) => {
    const req = https.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/health",
        rejectUnauthorized: false,
        timeout: 2000,
      },
      (res) => {
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => resolve({ status: res.statusCode, body: Buffer.concat(chunks).toString("utf8") }));
      },
    );
    req.on("error", reject);
  });
}

describe("listenTls", () => {
  it("answers HTTPS and rejects a plain HTTP client", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-cert-"));
    const { keyPath, certPath } = writeCert(dir);
    const server = await listenTls({
      keyPath,
      certPath,
      host: "127.0.0.1",
      port: 0,
      onRequest(_req, res) {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
      },
    });
    const addr = server.address();
    const port = typeof addr === "object" && addr ? addr.port : 0;
    try {
      const httpsResult = await httpsGet(port);
      assert.equal(httpsResult.status, 200);
      assert.equal(httpsResult.body, '{"ok":true}');

      const httpResult = await httpGet(port);
      assert.equal(httpResult.status, 0);
      assert.equal(httpResult.error?.code, "ECONNRESET");
    } finally {
      await new Promise((resolve) => server.close(resolve));
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
