#!/usr/bin/env node
/**
 * Production listen helper. Binds 127.0.0.1 unless FINANCE_HUB_BIND_HOST is set.
 * Public protocol follows SCHWAB_REDIRECT_URI. https uses the mkcert files
 * `npm run dev` writes at certificates/localhost.pem. An http redirect stays plain HTTP.
 * If that origin's /api/health is already 200, exit without a second process.
 * VPN/LAN: FINANCE_HUB_BIND_HOST=0.0.0.0 (or a Tailscale IP) plus FINANCE_HUB_API_KEY.
 * Leave FINANCE_HUB_ALLOW_BROKER_ORDERS unset.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";

import { listenLoopbackHttp, listenTls } from "./localHttps.mjs";
import { loopbackHealthOk } from "./loopbackHealth.mjs";
import { loadEnvLocal } from "./loadEnvLocal.mjs";
import { certFiles, certsPresent, missingCertMessage, resolveListen, wrongProtocolMessage } from "./schwabListen.mjs";

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const require = createRequire(import.meta.url);

function resolveBindHost() {
  return (process.env.FINANCE_HUB_BIND_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
}

function isLoopback(host) {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

function closeServer(server) {
  return new Promise((resolve) => {
    server.close(() => resolve());
  });
}

async function bootProductionHttps({ bindHost, port, keyPath, certPath }) {
  if (!process.env.NODE_ENV) process.env.NODE_ENV = "production";
  process.env.NEXT_RUNTIME = "nodejs";
  process.env.PORT = String(port);

  let handler = null;
  const waiting = [];
  const internal = await listenLoopbackHttp({
    port: 0,
    onRequest(req, res) {
      if (!handler) {
        waiting.push({ req, res });
        return;
      }
      return handler(req, res);
    },
  });
  const internalAddr = internal.address();
  const internalPort = typeof internalAddr === "object" && internalAddr ? internalAddr.port : 0;
  // In-process jobs call loopback HTTP. Node does not trust the mkcert CA, and the public port is TLS.
  if (!process.env.INTERNAL_APP_BASE_URL?.trim()) {
    process.env.INTERNAL_APP_BASE_URL = `http://127.0.0.1:${internalPort}`;
  }

  let app;
  try {
    const next = require("next");
    app = next({ dev: false, dir: root, hostname: bindHost, port });
    await app.prepare();
    handler = app.getRequestHandler();
    for (const item of waiting.splice(0)) {
      Promise.resolve(handler(item.req, item.res)).catch((err) => {
        console.error(err);
        if (!item.res.headersSent) item.res.statusCode = 500;
        item.res.end("Internal Server Error");
      });
    }
    const tls = await listenTls({
      keyPath,
      certPath,
      host: bindHost,
      port,
      onRequest: (req, res) => handler(req, res),
    });
    const shutdown = () => {
      void closeServer(tls);
      void closeServer(internal);
      void app.close?.();
    };
    process.once("SIGINT", () => {
      shutdown();
      process.exit(0);
    });
    process.once("SIGTERM", () => {
      shutdown();
      process.exit(0);
    });
  } catch (err) {
    for (const item of waiting.splice(0)) {
      if (!item.res.headersSent) item.res.statusCode = 503;
      item.res.end("starting");
    }
    await closeServer(internal);
    await app?.close?.();
    throw err;
  }
}

async function main() {
  loadEnvLocal(root);

  const bindHost = resolveBindHost();
  const port = Number(process.env.PORT ?? 3000) || 3000;

  if (!isLoopback(bindHost) && !process.env.FINANCE_HUB_API_KEY?.trim()) {
    console.error(
      `Refusing to bind ${bindHost} without FINANCE_HUB_API_KEY.\n` +
        `Use 127.0.0.1 for local-only, or set a key before VPN/LAN bind.\n` +
        `See docs/remote-desktop-vpn.md.`,
    );
    process.exit(1);
  }

  const files = certFiles(root, process.env);
  const redirectUri = process.env.SCHWAB_REDIRECT_URI;
  const plan = resolveListen({
    redirectUri,
    port,
    bindHost,
    mode: "start",
    certsPresent: certsPresent(files),
  });
  if (!plan.ok) {
    console.error(plan.message);
    process.exit(1);
  }

  const wantedUp = await loopbackHealthOk(port, 5000, plan.protocol);
  if (wantedUp) {
    console.log(`Finance Hub is already running at ${plan.origin}/`);
    process.exit(0);
  }

  const otherProtocol = plan.protocol === "https" ? "http" : "https";
  const otherUp = await loopbackHealthOk(port, 1500, otherProtocol);
  const occupied = wrongProtocolMessage({
    want: plan.protocol,
    httpUp: plan.protocol === "http" ? false : otherUp,
    httpsUp: plan.protocol === "https" ? false : otherUp,
    port,
    redirectUri: redirectUri?.trim() || plan.origin,
  });
  if (occupied) {
    console.error(occupied);
    process.exit(1);
  }

  if (plan.needsCerts) {
    console.error(missingCertMessage(redirectUri?.trim() || plan.origin, files.keyPath, files.certPath));
    process.exit(1);
  }

  console.log(`Finance Hub (next start) ${plan.origin}/`);
  if (!isLoopback(bindHost)) {
    console.log(
      `Remote desktop: open ${plan.protocol}://<vpn-or-tailscale-ip>:${port}/ — see docs/remote-desktop-vpn.md`,
    );
  }

  if (plan.protocol === "http") {
    const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
    const child = spawn(process.execPath, [nextBin, "start", "--hostname", bindHost, "--port", String(port)], {
      cwd: root,
      stdio: "inherit",
      env: process.env,
    });
    child.on("error", (err) => {
      console.error(err);
      process.exit(1);
    });
    child.on("exit", (code, signal) => {
      if (signal) process.kill(process.pid, signal);
      process.exit(code ?? 0);
    });
    return;
  }

  await bootProductionHttps({ bindHost, port, keyPath: files.keyPath, certPath: files.certPath });
}

const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
if (entry === fileURLToPath(import.meta.url)) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
