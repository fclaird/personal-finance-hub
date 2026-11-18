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
