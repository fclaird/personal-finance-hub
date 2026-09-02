#!/usr/bin/env node
/**
 * Production Next listen helper. Defaults to 127.0.0.1.
 * VPN/LAN: FINANCE_HUB_BIND_HOST=0.0.0.0 (or a Tailscale IP) plus FINANCE_HUB_API_KEY.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvLocal } from "./loadEnvLocal.mjs";

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
loadEnvLocal(root);

function resolveBindHost() {
  return (process.env.FINANCE_HUB_BIND_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
}

function isLoopback(host) {
  const h = host.trim().toLowerCase();
  return h === "127.0.0.1" || h === "::1" || h === "localhost";
}

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

console.log(`Finance Hub (next start) http://${bindHost}:${port}/`);
if (!isLoopback(bindHost)) {
  console.log("Remote desktop: open http://<vpn-or-tailscale-ip>:" + port + "/ — see docs/remote-desktop-vpn.md");
}

const nextBin = path.join(root, "node_modules", "next", "dist", "bin", "next");
const child = spawn(process.execPath, [nextBin, "start", "--hostname", bindHost, "--port", String(port)], {
  cwd: root,
  stdio: "inherit",
  env: process.env,
});
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
