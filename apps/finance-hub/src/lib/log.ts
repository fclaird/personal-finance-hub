import fs from "node:fs";
import path from "node:path";

import { capDiagnosticText } from "@/lib/diagnosticText";
import { ensureDirSync } from "@/lib/fs";
import { getAppDataDir } from "@/lib/paths";

/** Rotate app.log once it grows past this size. One backup: app.log.1. */
export const APP_LOG_MAX_BYTES = 8 * 1024 * 1024;

/** One append cannot carry a Schwab HTML/JSON body. */
export const APP_LOG_LINE_MAX_CHARS = 400;

function getLogPath() {
  return path.join(getAppDataDir(), "logs", "app.log");
}

export function errorToLogText(err: unknown): string {
  if (err instanceof Error) {
    const stack = err.stack ? `\n${err.stack}` : "";
    return `${err.name}: ${err.message}${stack}`;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}

function rotateLogFileIfNeeded(logPath: string, maxBytes: number) {
  let size = 0;
  try {
    size = fs.statSync(logPath).size;
  } catch {
    return;
  }
  if (size <= maxBytes) return;
  const backup = `${logPath}.1`;
  try {
    fs.rmSync(backup, { force: true });
    fs.renameSync(logPath, backup);
  } catch {
    // Best-effort. A later append is still length-capped.
  }
}

export function appendAppLog(logPath: string, message: string, maxBytes = APP_LOG_MAX_BYTES) {
  const dir = path.dirname(logPath);
  ensureDirSync(dir);
  rotateLogFileIfNeeded(logPath, maxBytes);
  const line = `[${new Date().toISOString()}] ${capDiagnosticText(message, APP_LOG_LINE_MAX_CHARS)}\n`;
  fs.appendFileSync(logPath, line, "utf-8");
}

export function logLine(message: string) {
  try {
    appendAppLog(getLogPath(), message);
  } catch {
    // Best-effort logging only.
  }
}

export function logError(context: string, err: unknown) {
  logLine(`${context}: ${errorToLogText(err)}`);
}
