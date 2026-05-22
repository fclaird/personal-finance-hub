import path from "node:path";

export const APP_DIR_NAME = "finance-hub";

/**
 * Local-only app data directory.
 *
 * We keep all runtime data out of the repo (SQLite, encrypted tokens, logs).
 */
export function getAppDataDir(): string {
  const home = process.env.HOME ?? process.env.USERPROFILE;
  if (!home) throw new Error("Unable to determine user home directory.");
  return path.join(home, ".local", "share", APP_DIR_NAME);
}

export function getDbPath(): string {
  return path.join(getAppDataDir(), "finance-hub.sqlite");
}

export function getSecretsPath(): string {
  return path.join(getAppDataDir(), "secrets.json.enc");
}

