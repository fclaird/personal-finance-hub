/**
 * Electron main: spawns Next standalone (or `next dev` in dev), waits for /api/health, opens BrowserWindow.
 */
const { app, BrowserWindow } = require("electron");
const { spawn } = require("node:child_process");
const path = require("node:path");
const fs = require("node:fs");
const http = require("node:http");

const DEV = process.env.FINANCE_HUB_ELECTRON_DEV === "1";
const DEFAULT_PORT = 3049;

let mainWindow = null;
let serverChild = null;
let serverPort = Number(process.env.PORT || DEFAULT_PORT) || DEFAULT_PORT;

function serverRoot() {
  if (DEV) return path.join(__dirname, "..");
  return path.join(process.resourcesPath, "server");
}

function nodeBin(serverDir) {
  const bundled = path.join(serverDir, process.platform === "win32" ? "node.exe" : "node");
  if (fs.existsSync(bundled)) return bundled;
  return process.platform === "win32" ? "node.exe" : "node";
}

function startServer() {
  return new Promise((resolve, reject) => {
    const rootDir = serverRoot();
    const env = {
      ...process.env,
      FINANCE_HUB_ELECTRON_DEV: "1",
      PORT: String(serverPort),
      HOSTNAME: "127.0.0.1",
      HOST: "127.0.0.1",
      NODE_ENV: DEV ? "development" : "production",
      /** Desktop: scheduler + local cron use this base (see src/lib/scheduler.ts, src/instrumentation.ts). */
      INTERNAL_APP_BASE_URL: `http://127.0.0.1:${serverPort}`,
    };

    if (DEV) {
      const nextBinJs = path.join(rootDir, "node_modules", "next", "dist", "bin", "next");
      if (!fs.existsSync(nextBinJs)) {
        reject(new Error(`Missing ${nextBinJs}. Run npm install from repo root.`));
        return;
      }
      const nodeCmd = process.env.FINANCE_HUB_DEV_NODE || "node";
      serverChild = spawn(nodeCmd, [nextBinJs, "dev", "--hostname", "127.0.0.1", "--port", String(serverPort)], {
        cwd: rootDir,
        env,
        stdio: "inherit",
      });
    } else {
      const serverJs = path.join(rootDir, "server.js");
      if (!fs.existsSync(serverJs)) {
        reject(new Error(`Missing server bundle at ${serverJs}. Run desktop:prepare after next build.`));
        return;
      }
      const exe = nodeBin(rootDir);
      serverChild = spawn(exe, [serverJs], {
        cwd: rootDir,
        env,
        stdio: "inherit",
      });
    }

    serverChild.on("error", reject);
    serverChild.on("exit", (code, signal) => {
      if (code !== 0 && code !== null && mainWindow && !mainWindow.isDestroyed()) {
        console.error("Next server exited:", code, signal);
      }
    });

    waitForHealth()
      .then(() => resolve())
      .catch(reject);
  });
}

function waitForHealth(maxMs = 120_000) {
  const started = Date.now();
  const url = `http://127.0.0.1:${serverPort}/api/health`;

  return new Promise((resolve, reject) => {
    const tick = () => {
      if (Date.now() - started > maxMs) {
        reject(new Error(`Timeout waiting for ${url}`));
        return;
      }
      const req = http.get(url, (res) => {
        res.resume();
        if (res.statusCode && res.statusCode >= 200 && res.statusCode < 300) {
          resolve();
          return;
        }
        setTimeout(tick, 500);
      });
      req.on("error", () => setTimeout(tick, 500));
    };
    setTimeout(tick, 400);
  });
}

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  mainWindow.loadURL(`http://127.0.0.1:${serverPort}/`);
  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

function killServer() {
  if (serverChild && !serverChild.killed) {
    try {
      serverChild.kill("SIGTERM");
    } catch {
      /* ignore */
    }
    serverChild = null;
  }
}

const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });

  app.whenReady().then(async () => {
    try {
      await startServer();
      createWindow();
    } catch (e) {
      console.error(e);
      app.quit();
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") {
      killServer();
      app.quit();
    }
  });

  app.on("before-quit", () => {
    killServer();
  });

  app.on("activate", () => {
    if (BrowserWindow.getAllWindows().length === 0) {
      createWindow();
    }
  });
}
