/**
 * After `next build`, copies the standalone server layout into desktop/server-bundle/
 * for Electron extraResources. Also copies the current `node` binary from PATH so
 * the packaged app can spawn the server without relying on a system-wide Node install.
 *
 * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/output
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execSync } from "node:child_process";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "..");
const standaloneSrc = path.join(root, ".next", "standalone");
const staticSrc = path.join(root, ".next", "static");
const publicSrc = path.join(root, "public");
const dest = path.join(root, "desktop", "server-bundle");

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function cp(src, dst) {
  fs.cpSync(src, dst, { recursive: true, dereference: true });
}

if (!fs.existsSync(standaloneSrc)) {
  console.error("Missing .next/standalone — run `next build` first.");
  process.exit(1);
}

rmrf(dest);
cp(standaloneSrc, dest);

const destStatic = path.join(dest, ".next", "static");
fs.mkdirSync(path.dirname(destStatic), { recursive: true });
if (fs.existsSync(staticSrc)) {
  rmrf(destStatic);
  cp(staticSrc, destStatic);
}

const destPublic = path.join(dest, "public");
if (fs.existsSync(publicSrc)) {
  rmrf(destPublic);
  cp(publicSrc, destPublic);
}

/** Bundle Node from PATH (packager machine arch). */
try {
  const whichCmd = process.platform === "win32" ? "where node" : "which node";
  const nodeFromPath = execSync(whichCmd, { encoding: "utf8" }).trim().split(/\r?\n/)[0];
  if (nodeFromPath && fs.existsSync(nodeFromPath)) {
    const destNode = path.join(dest, process.platform === "win32" ? "node.exe" : "node");
    fs.copyFileSync(nodeFromPath, destNode);
    try {
      fs.chmodSync(destNode, 0o755);
    } catch {
      /* windows */
    }
    console.log("Bundled Node:", destNode);
  } else {
    console.warn("Could not resolve node from PATH; desktop pack will use `node` from PATH at runtime.");
  }
} catch (e) {
  console.warn("Skipping Node copy:", e instanceof Error ? e.message : e);
}

console.log("Standalone bundle ready at:", dest);
