#!/usr/bin/env node
/**
 * Start Next dev with a Node binary that matches the better-sqlite3 native build.
 * On Apple Silicon, `npm run dev` often uses Homebrew x64 Node while postinstall built arm64.
 */
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");

/** arm64 Node bundled with Cursor; override with FINANCE_HUB_NODE. */
const CURSOR_ARM64_NODE =
  "/Applications/Cursor.app/Contents/Resources/app/resources/helpers/node";

function resolveDevNode() {
  if (process.env.FINANCE_HUB_NODE?.trim()) return process.env.FINANCE_HUB_NODE.trim();
  if (process.platform === "darwin" && process.arch === "x64") {
    try {
      const arch = spawnSync(CURSOR_ARM64_NODE, ["-p", "process.arch"], { encoding: "utf8" }).stdout?.trim();
      if (arch === "arm64") return CURSOR_ARM64_NODE;
    } catch {
      /* fall through */
    }
  }
  return process.execPath;
}

const nodeBin = resolveDevNode();

const ensure = spawnSync(nodeBin, ["scripts/ensure-sqlite-native.mjs"], {
  cwd: root,
  stdio: "inherit",
});
if (ensure.status !== 0) process.exit(ensure.status ?? 1);

const bindHost = (process.env.FINANCE_HUB_BIND_HOST ?? "127.0.0.1").trim() || "127.0.0.1";

const nextArgs = ["node_modules/next/dist/bin/next", "dev", "--experimental-https", "--hostname", bindHost];
const child = spawn(nodeBin, nextArgs, { cwd: root, stdio: "inherit", env: process.env });
child.on("exit", (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  process.exit(code ?? 0);
});
