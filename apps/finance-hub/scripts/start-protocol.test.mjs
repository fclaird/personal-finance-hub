import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import http from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

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

function runStart(env) {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, ["scripts/start.mjs"], {
      cwd: root,
      env: {
        ...process.env,
        FINANCE_HUB_BIND_HOST: "127.0.0.1",
        ...env,
      },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => {
      stdout += d;
    });
    child.stderr.on("data", (d) => {
      stderr += d;
    });
    const timer = setTimeout(() => {
      child.kill("SIGTERM");
    }, 4000);
    child.on("exit", (code) => {
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
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
