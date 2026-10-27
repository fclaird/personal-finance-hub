import fs from "node:fs";
import path from "node:path";

const SOURCE_REL = ["src", "scripts", "package.json", "package-lock.json", "next.config.ts", "postcss.config.mjs", "tsconfig.json"];

export function productionSteps({ mode, rebuild, buildIdMtimeMs, newestSourceMtimeMs }) {
  if (mode === "dev") return ["dev"];
  if (mode === "start") return ["start"];
  if (mode !== "prod") {
    throw new Error(`Unknown launch mode "${mode}". Use prod (default), start, or dev.`);
  }
  const hasBuild = buildIdMtimeMs != null;
  const sourcesNewer = hasBuild && newestSourceMtimeMs != null && newestSourceMtimeMs > buildIdMtimeMs;
  if (rebuild || !hasBuild || sourcesNewer) return ["build", "start"];
  return ["start"];
}

function newestMtime(root, rel) {
  const abs = path.join(root, rel);
  if (!fs.existsSync(abs)) return null;
  const stat = fs.statSync(abs);
  if (!stat.isDirectory()) return stat.mtimeMs;
  let newest = stat.mtimeMs;
  for (const entry of fs.readdirSync(abs, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === ".next") continue;
    const child = newestMtime(abs, entry.name);
    if (child != null && child > newest) newest = child;
  }
  return newest;
}

export function newestSourceMtimeMs(root) {
  let newest = null;
  for (const rel of SOURCE_REL) {
    const mtime = newestMtime(root, rel);
    if (mtime != null && (newest == null || mtime > newest)) newest = mtime;
  }
  return newest;
}

export function readLaunchInputs(root, env = process.env) {
  const buildId = path.join(root, ".next", "BUILD_ID");
  let buildIdMtimeMs = null;
  if (fs.existsSync(buildId)) buildIdMtimeMs = fs.statSync(buildId).mtimeMs;
  return {
    rebuild: env.FINANCE_HUB_REBUILD === "1",
    buildIdMtimeMs,
    newestSourceMtimeMs: newestSourceMtimeMs(root),
  };
}

function isDirectRun() {
  const entry = process.argv[1] ? path.resolve(process.argv[1]) : "";
  return entry.endsWith(`${path.sep}launchPlan.mjs`);
}

if (isDirectRun()) {
  const mode = (process.argv[2] ?? "prod").trim() || "prod";
  const root = process.argv[3] ? path.resolve(process.argv[3]) : path.join(path.dirname(new URL(import.meta.url).pathname), "..");
  const steps = productionSteps({ mode, ...readLaunchInputs(root) });
  process.stdout.write(`${steps.join("\n")}\n`);
}
