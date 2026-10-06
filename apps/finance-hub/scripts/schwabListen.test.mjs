import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, it } from "node:test";

import { devNextArgs, missingCertMessage, resolveListen, wrongProtocolMessage } from "./schwabListen.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");

describe("resolveListen", () => {
  it("keeps plain HTTP when the redirect URI is http", () => {
    const plan = resolveListen({
      redirectUri: "http://127.0.0.1:3000/api/schwab/callback",
      port: 3000,
      bindHost: "127.0.0.1",
      mode: "start",
      certsPresent: false,
    });
    assert.deepEqual(plan, {
      ok: true,
      protocol: "http",
      origin: "http://127.0.0.1:3000",
      port: 3000,
      bindHost: "127.0.0.1",
      needsCerts: false,
    });
  });

  it("selects HTTPS and asks for certs when the redirect URI is https", () => {
    const plan = resolveListen({
      redirectUri: "https://127.0.0.1:3000/api/schwab/callback",
      port: 3000,
      bindHost: "127.0.0.1",
      mode: "start",
      certsPresent: false,
    });
    assert.equal(plan.ok, true);
    assert.equal(plan.protocol, "https");
    assert.equal(plan.origin, "https://127.0.0.1:3000");
    assert.equal(plan.needsCerts, true);
    assert.equal(
      missingCertMessage(
        "https://127.0.0.1:3000/api/schwab/callback",
        "/tmp/localhost-key.pem",
        "/tmp/localhost.pem",
      ),
      "Refusing to start. SCHWAB_REDIRECT_URI is https://127.0.0.1:3000/api/schwab/callback, so Finance Hub will not listen with plain HTTP.\n" +
        "Missing /tmp/localhost.pem and /tmp/localhost-key.pem.\n" +
        "Run: npm run dev",
    );
  });

  it("serves HTTPS without asking for certs once the files exist", () => {
    const plan = resolveListen({
      redirectUri: "https://127.0.0.1:3000/api/schwab/callback",
      port: 3000,
      bindHost: "127.0.0.1",
      mode: "start",
      certsPresent: true,
    });
    assert.equal(plan.protocol, "https");
    assert.equal(plan.needsCerts, false);
  });

  it("refuses a port that does not match the redirect", () => {
    const plan = resolveListen({
      redirectUri: "https://127.0.0.1:3000/api/schwab/callback",
      port: 4000,
      bindHost: "127.0.0.1",
      mode: "start",
      certsPresent: true,
    });
    assert.equal(plan.ok, false);
    assert.equal(
      plan.message,
      "Refusing to start. SCHWAB_REDIRECT_URI is https://127.0.0.1:3000/api/schwab/callback (port 3000) but PORT is 4000.\n" +
        "Run: PORT=3000 npm start",
    );
  });

  it("leaves dev on HTTPS when no redirect URI is set, and drops the https flag for an http URI", () => {
    const unset = resolveListen({
      redirectUri: "",
      port: 3000,
      bindHost: "127.0.0.1",
      mode: "dev",
      certsPresent: false,
    });
    assert.equal(unset.protocol, "https");
    assert.deepEqual(devNextArgs({ protocol: "https", bindHost: "127.0.0.1", port: 3000 }), [
      "node_modules/next/dist/bin/next",
      "dev",
      "--experimental-https",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ]);
    assert.deepEqual(devNextArgs({ protocol: "http", bindHost: "127.0.0.1", port: 3000 }), [
      "node_modules/next/dist/bin/next",
      "dev",
      "--hostname",
      "127.0.0.1",
      "--port",
      "3000",
    ]);
  });

  it("prints the origin the Dock launcher should open", () => {
    const base = {
      ...process.env,
      PORT: "3000",
      FINANCE_HUB_BIND_HOST: "127.0.0.1",
      FINANCE_HUB_CERT_DIR: "/tmp/finance-hub-certs-missing",
    };
    const https = spawnSync(process.execPath, ["scripts/print-listen-origin.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: { ...base, SCHWAB_REDIRECT_URI: "https://127.0.0.1:3000/api/schwab/callback" },
    });
    assert.equal(https.status, 1);
    assert.match(https.stderr, /Run: npm run dev/);

    const http = spawnSync(process.execPath, ["scripts/print-listen-origin.mjs"], {
      cwd: root,
      encoding: "utf8",
      env: { ...base, SCHWAB_REDIRECT_URI: "http://127.0.0.1:3000/api/schwab/callback" },
    });
    assert.equal(http.status, 0);
    assert.equal(http.stdout, "http://127.0.0.1:3000\n");
  });

  it("names the command to stop a server that already speaks the other protocol", () => {
    assert.equal(
      wrongProtocolMessage({
        want: "https",
        httpUp: true,
        httpsUp: false,
        port: 3000,
        redirectUri: "https://127.0.0.1:3000/api/schwab/callback",
      }),
      "Refusing to start. 127.0.0.1:3000 is already speaking plain HTTP, but SCHWAB_REDIRECT_URI is https://127.0.0.1:3000/api/schwab/callback.\n" +
        "Stop that process, then run: npm start",
    );
  });
});
