# Financial Bridge production launcher

The login item serves a production build. `npm run dev` is for a manual coding session only.

The URL stays `https://127.0.0.1:3000` when `SCHWAB_REDIRECT_URI` is that origin, so the flavor and Schwab cookies keep the same host. `next start` does not speak TLS. `scripts/start.mjs` terminates HTTPS with the mkcert files in `certificates/` and hands requests to the production Next handler.

## Install on the Mac

From the finance-hub app directory, on the Intel Node at `/usr/local/bin/node`:

```bash
cd ~/Projects/personal-finance-hub/apps/finance-hub
/usr/local/bin/node -p process.arch    # must print x64
chmod +x scripts/launch-financial-bridge.sh scripts/open-bridge-window.sh scripts/install-financial-bridge.sh
./scripts/install-financial-bridge.sh
```

That symlinks `~/bin/launch-financial-bridge.sh` at this repo script and reloads `~/Library/LaunchAgents/com.chris.financialbridge.plist`. It does not run `npm rebuild`, does not change `.env.local`, and does not touch token files.

launchd's PATH is `/usr/bin:/bin`. The launcher and the plist put `/usr/local/bin` first so Turbopack's PostCSS worker can spawn `node` during `next build`. If `launchctl bootstrap` fails right after `bootout` (often `EIO`), the installer retries it.

The Dock / Automator icon can keep pointing at `scripts/open-finance-hub.command`. That file execs the same launcher. If the server is already up, it only closes Bridge tabs and opens one full-screen window.

## What it does

1. Stops stale Hub processes: listeners on port 3000 that are Next or this repo, and `next dev` / `next start` / `scripts/start.mjs` launched from this app. Other node processes are left alone.
2. Runs `next build` with `/usr/local/bin/node` when `HEAD` or `package-lock.json` differs from `.next/finance-hub-build-stamp`. A matching stamp skips the build.
3. If the build fails and `.next-last-good` has a `BUILD_ID`, the previous build is put back and served. The error is appended to `~/Library/Logs/finance-hub/bridge.log`.
4. Serves that build. A watchdog in the supervisor restarts the server process when `/api/health` stops answering or `heapUsed` exceeds 1536 MB (`FINANCE_HUB_DEV_WATCHDOG_HEAP_MB`). It only signals the process tree it spawned.
5. Closes Chrome or Safari tabs whose URL is this hub, leaves every other tab, and opens one full-screen window.

## Confirm it is the production build

```bash
curl -kfsS https://127.0.0.1:3000/api/health
```

Expect `"ok": true` and `"runtime": "production"`. The supervisor log line is `runtime=production`.

```bash
tail -n 50 ~/Library/Logs/finance-hub/bridge.log
```

Look for `build_skipped` or `build_ok`, then `serve pid=… runtime=production`. Watchdog lines in the same file look like `health_unresponsive` and `restarting next-server`.

Event-loop lines in the same file are prefixed `[event-loop]`. Once a minute: `vitals heap_mb=… rss_mb=… lag_p99_ms=…`. When the 10-second p99 exceeds 500ms: `event_loop_lag` plus `inflight=`, each job as `name start=<ISO> age_ms=<n>`. Every scheduled job also logs `job_start` and `job_end` with `name`, `start`, `end`, and `ms`. A stall that ends in `health_unresponsive` should have a `job_start` with no `job_end` yet, usually `wal_checkpoint`, `schwab_holdings`, `schwab_transactions`, or `glance_warm`. `event_loop_lag` also names `gc=` and `stacks=` (V8 samples from the same 10s window). `vitals` includes `external_mb` and `array_buffers_mb`.

Soak the production server without touching the live database:

```bash
cd ~/Projects/personal-finance-hub/apps/finance-hub && ./scripts/install-financial-bridge.sh && /usr/local/bin/node scripts/soak-production.mjs --minutes 30
```

The last line is `SOAK PASS` or `SOAK FAIL`.

`lsof -nP -iTCP:3000 -sTCP:LISTEN` should show a `node` process running `scripts/start.mjs`, not `next dev`.

## Dev mode

```bash
cd ~/Projects/personal-finance-hub/apps/finance-hub
npm run dev
```

Stop the login agent first so it does not fight the dev server for port 3000:

```bash
launchctl bootout gui/$(id -u)/com.chris.financialbridge
```

Start it again with `./scripts/install-financial-bridge.sh` or `launchctl bootstrap gui/$(id -u) ~/Library/LaunchAgents/com.chris.financialbridge.plist`.
