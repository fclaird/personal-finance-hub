#!/usr/bin/env node
/**
 * Run the production server against a seeded database and print SOAK PASS or SOAK FAIL.
 *
 * Chris's Mac, one command (reinstall the login item, then soak without touching the live db):
 *   cd ~/Projects/personal-finance-hub/apps/finance-hub && ./scripts/install-financial-bridge.sh && /usr/local/bin/node scripts/soak-production.mjs --minutes 30
 *
 * Fails when event-loop p99 exceeds 200ms, max exceeds 1000ms, RSS grows past the cap,
 * or any /api/health probe fails.
 */
import { spawn, execFileSync } from "node:child_process";
import fs from "node:fs";
import http from "node:http";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";

const root = path.join(fileURLToPath(new URL(".", import.meta.url)), "..");
const P99_LIMIT_MS = 200;
const MAX_LIMIT_MS = 1000;
const RSS_ABSOLUTE_MB = 1536;
const RSS_GROWTH_MB = 1024;

function argMinutes() {
  const i = process.argv.indexOf("--minutes");
  const n = i >= 0 ? Number(process.argv[i + 1]) : 30;
  if (!Number.isFinite(n) || n <= 0) return 30;
  return n;
}

function argPort() {
  const i = process.argv.indexOf("--port");
  const n = i >= 0 ? Number(process.argv[i + 1]) : 3456;
  return Number.isFinite(n) && n > 0 ? n : 3456;
}

function rssMb(pid) {
  try {
    const status = fs.readFileSync(`/proc/${pid}/status`, "utf8");
    const match = status.match(/VmRSS:\s+(\d+)/);
    if (match) return Number(match[1]) / 1024;
  } catch {
    /* macOS */
  }
  try {
    const out = execFileSync("ps", ["-o", "rss=", "-p", String(pid)], { encoding: "utf8" }).trim();
    const n = Number(out);
    return Number.isFinite(n) ? n / 1024 : 0;
  } catch {
    return 0;
  }
}

function childPids(pid) {
  try {
    const out = execFileSync("ps", ["-o", "pid=", "--ppid", String(pid)], { encoding: "utf8" });
    return out
      .split(/\s+/)
      .map((part) => Number(part))
      .filter((n) => Number.isFinite(n) && n > 1);
  } catch {
    try {
      const out = execFileSync("pgrep", ["-P", String(pid)], { encoding: "utf8" });
      return out
        .split(/\s+/)
        .map((part) => Number(part))
        .filter((n) => Number.isFinite(n) && n > 1);
    } catch {
      return [];
    }
  }
}

function treeRssMb(pid) {
  const seen = new Set();
  let peak = 0;
  function walk(id) {
    if (seen.has(id)) return;
    seen.add(id);
    peak = Math.max(peak, rssMb(id));
    for (const child of childPids(id)) walk(child);
  }
  walk(pid);
  return peak;
}

function probeHealth(port) {
  return new Promise((resolve) => {
    const req = http.get({ hostname: "127.0.0.1", port, path: "/api/health", timeout: 5000 }, (res) => {
      res.resume();
      resolve(res.statusCode === 200);
    });
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
    req.on("error", () => resolve(false));
  });
}

function seedDatabase(dbPath) {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma("journal_mode = WAL");
  db.exec(fs.readFileSync(path.join(root, "src", "db", "schema.sql"), "utf8"));
  db.prepare(
    `INSERT INTO institution_connections (id, type, display_name, status, created_at, updated_at)
     VALUES ('c1', 'schwab', 'Schwab', 'active', datetime('now'), datetime('now'))`,
  ).run();
  db.prepare(
    `INSERT INTO accounts (id, connection_id, name, type, currency, updated_at)
     VALUES ('schwab_soak', 'c1', 'Soak', 'MARGIN', 'USD', datetime('now'))`,
  ).run();
  const insertTx = db.prepare(
    `INSERT INTO broker_transactions (
      id, account_id, external_activity_id, trade_date, transaction_type, net_amount, raw_json, symbol,
      asset_type, instruction, position_effect, quantity, price, leg_count, updated_at
    ) VALUES (?, 'schwab_soak', ?, '2026-11-01', 'TRADE', 10, ?, 'SPY', 'EQUITY', 'BUY', 'OPENING', 1, 10, 1, datetime('now'))`,
  );
  const raw = JSON.stringify({
    activityId: 1,
    type: "TRADE",
    description: "x".repeat(1200),
    transferItems: [{ instrument: { symbol: "SPY", assetType: "EQUITY" }, amount: 1 }],
  });
  const insertCandle = db.prepare(
    `INSERT INTO ohlcv_points (provider, symbol, interval, ts_ms, open, high, low, close, volume)
     VALUES ('schwab', 'SPY', '5m', ?, 100, 101, 99, 100.5, 1000)`,
  );
  const points = Array.from({ length: 1500 }, (_, i) => ({ idx: i, close: 100 + i * 0.01, tsMs: 1_700_000_000_000 + i * 300_000 }));
  const series = JSON.stringify({
    items: [{ series: points, extendedSeries: null }],
    alternateGlanceItems: [],
    futuresGlanceItems: [],
  });
  const shell = JSON.stringify({
    ok: true,
    session: { headline: "Soak", detail: "", isOpen: true, sessionYmd: "2026-11-19", chartYmd: "2026-11-19", sessionLabel: "Thu", showingPriorSession: false },
    items: [{ id: "portfolio", label: "Portfolio", symbol: "PORT", last: 100, change: 1, changePct: 0.01, previousClose: 99, series: [] }],
    alternateGlanceItems: [],
    futuresGlanceItems: [],
    updatedAt: "2026-11-19T15:00:00.000Z",
  });
  const tx = db.transaction(() => {
    for (let i = 0; i < 4000; i++) insertTx.run(`btx-${i}`, String(i), raw);
    for (let i = 0; i < 8000; i++) insertCandle.run(1_700_000_000_000 + i * 300_000);
    for (const flavor of ["main", "rorie", "peyton"]) {
      db.prepare(
        `INSERT INTO glance_cache (cache_key, session_ymd, payload_json, updated_at) VALUES (?, '2026-11-19', ?, '2020-01-01T00:00:00.000Z')`,
      ).run(`us-markets:${flavor}`, shell);
      db.prepare(
        `INSERT INTO glance_cache_series (cache_key, session_ymd, series_json) VALUES (?, '2026-11-19', ?)`,
      ).run(`us-markets:${flavor}`, series);
    }
  });
  tx();
  db.close();
}

function worstLag(logPath) {
  let p99 = 0;
  let max = 0;
  if (!fs.existsSync(logPath)) return { p99, max };
  const text = fs.readFileSync(logPath, "utf8");
  for (const line of text.split("\n")) {
    if (!line.includes("vitals ") && !line.includes("event_loop_lag ")) continue;
    const p99Match = line.match(/(?:lag_)?p99_ms=([0-9.]+)/);
    const maxMatch = line.match(/(?:lag_)?max_ms=([0-9.]+)/);
    if (p99Match) p99 = Math.max(p99, Number(p99Match[1]));
    if (maxMatch) max = Math.max(max, Number(maxMatch[1]));
  }
  return { p99, max };
}

async function main() {
  const minutes = argMinutes();
  const port = argPort();
  const home = fs.mkdtempSync(path.join(os.tmpdir(), "fh-soak-"));
  const dbPath = path.join(home, ".local", "share", "finance-hub", "finance-hub.sqlite");
  const logPath = path.join(home, "bridge.log");
  if (!fs.existsSync(path.join(root, ".next", "BUILD_ID"))) {
    console.error("SOAK FAIL missing .next build. Run npm run build in apps/finance-hub first.");
    process.exit(1);
  }
  seedDatabase(dbPath);
  const child = spawn(process.execPath, [path.join(root, "scripts", "start.mjs")], {
    cwd: root,
    env: {
      ...process.env,
      HOME: home,
      PORT: String(port),
      NODE_ENV: "production",
      SCHWAB_REDIRECT_URI: `http://127.0.0.1:${port}`,
      FINANCE_HUB_BIND_HOST: "127.0.0.1",
      FINANCE_HUB_BRIDGE_LOG: logPath,
      FINANCE_HUB_EVENT_LOOP_LOG: "1",
      FINANCE_HUB_OPEN_WINDOW: "0",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  const serverLog = fs.createWriteStream(path.join(home, "server.log"));
  child.stdout?.pipe(serverLog);
  child.stderr?.pipe(serverLog);

  let healthFailures = 0;
  let probes = 0;
  const stop = () => {
    try {
      child.kill("SIGTERM");
    } catch {
      /* already gone */
    }
  };
  process.on("SIGINT", () => {
    stop();
    process.exit(1);
  });

  const deadline = Date.now() + minutes * 60_000;
  const startedWait = Date.now();
  let up = false;
  while (Date.now() - startedWait < 120_000) {
    if (await probeHealth(port)) {
      up = true;
      break;
    }
    if (child.exitCode != null) break;
    await new Promise((resolve) => setTimeout(resolve, 1000));
  }
  if (!up) {
    stop();
    console.error(`SOAK FAIL server did not answer /api/health on 127.0.0.1:${port}`);
    process.exit(1);
  }

  await new Promise((resolve) => setTimeout(resolve, 15_000));
  const rssStart = treeRssMb(child.pid);
  let rssPeak = rssStart;
  while (Date.now() < deadline) {
    probes += 1;
    const ok = await probeHealth(port);
    if (!ok) healthFailures += 1;
    rssPeak = Math.max(rssPeak, treeRssMb(child.pid));
    if (child.exitCode != null) {
      healthFailures += 1;
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, 10_000));
  }
  const rssEnd = treeRssMb(child.pid);
  rssPeak = Math.max(rssPeak, rssEnd);
  stop();
  await new Promise((resolve) => {
    const timer = setTimeout(resolve, 3000);
    child.once("exit", () => {
      clearTimeout(timer);
      resolve();
    });
  });

  const lag = worstLag(logPath);
  const growth = rssEnd - rssStart;
  const reasons = [];
  if (healthFailures > 0) reasons.push(`health_failures=${healthFailures}`);
  if (lag.p99 > P99_LIMIT_MS) reasons.push(`lag_p99_ms=${lag.p99.toFixed(0)}>${P99_LIMIT_MS}`);
  if (lag.max > MAX_LIMIT_MS) reasons.push(`lag_max_ms=${lag.max.toFixed(0)}>${MAX_LIMIT_MS}`);
  if (rssPeak > RSS_ABSOLUTE_MB) reasons.push(`rss_peak_mb=${rssPeak.toFixed(0)}>${RSS_ABSOLUTE_MB}`);
  if (growth > RSS_GROWTH_MB) reasons.push(`rss_growth_mb=${growth.toFixed(0)}>${RSS_GROWTH_MB}`);
  const summary = `minutes=${minutes} probes=${probes} health_failures=${healthFailures} lag_p99_max=${lag.p99.toFixed(0)} lag_max_max=${lag.max.toFixed(0)} rss_start_mb=${rssStart.toFixed(0)} rss_end_mb=${rssEnd.toFixed(0)} rss_peak_mb=${rssPeak.toFixed(0)} log=${logPath}`;
  if (reasons.length > 0) {
    console.error(`SOAK FAIL ${summary} ${reasons.join(" ")}`);
    process.exit(1);
  }
  console.log(`SOAK PASS ${summary}`);
}

main().catch((err) => {
  console.error(`SOAK FAIL ${err instanceof Error ? err.stack || err.message : String(err)}`);
  process.exit(1);
});
