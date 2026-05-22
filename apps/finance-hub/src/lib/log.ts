import fs from "node:fs";
import path from "node:path";

import { ensureDirSync } from "@/lib/fs";
import { getAppDataDir } from "@/lib/paths";

function getLogPath() {
  return path.join(getAppDataDir(), "logs", "app.log");
}

export function logLine(message: string) {
  try {
    const dir = path.dirname(getLogPath());
    ensureDirSync(dir);
    fs.appendFileSync(getLogPath(), `[${new Date().toISOString()}] ${message}\n`, "utf-8");
  } catch {
    // Best-effort logging only.
  }
}

export function logError(context: string, err: unknown) {
  const msg =
    err instanceof Error
      ? `${err.name}: ${err.message}\n${err.stack ?? ""}`
      : typeof err === "string"
        ? err
        : JSON.stringify(err);
  logLine(`${context}: ${msg}`);
}

