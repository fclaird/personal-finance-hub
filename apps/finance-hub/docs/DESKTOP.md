# Finance Hub desktop (Electron)

The desktop shell runs the **same** Next.js standalone server locally (with `better-sqlite3` inside that Node process) and opens a window to `http://127.0.0.1:<port>/`. SQLite and secrets still use `~/.local/share/finance-hub/` ([`src/lib/paths.ts`](src/lib/paths.ts)).

## Quick commands

| Script | Purpose |
|--------|---------|
| `npm run desktop:dev` | Dev: Electron + `next dev` on port **3049** (set `PORT` to override). Uses **`.next-desktop/`** so you can keep `npm run dev` on port 3000 at the same time. |
| `npm run desktop:dev:win` | Windows variant of the above. |
| `npm run desktop:prepare` | After `next build`, copy `.next/standalone` + static + `public` into `desktop/server-bundle/`, and copy `node` from your `PATH` into that folder for the packaged app. |
| `npm run desktop:pack` | Production build + prepare + **unpacked** Electron app under `desktop/out/`. |
| `npm run desktop:dist` | Same + DMG / NSIS / AppImage (per current OS). |

## OAuth / Schwab redirect (desktop)

The Electron main process defaults to **port 3049** to avoid clashing with a separate `next dev` on 3000.

Set in `.env.local` (must match the Schwab developer portal callback **exactly**):

```bash
SCHWAB_REDIRECT_URI=http://127.0.0.1:3049/api/schwab/callback
```

If you change `PORT` in the environment before launching Electron, use that port in the URI instead. For X/Twitter OAuth, set `X_REDIRECT_URI` to the same host/port pattern.

Optional: `INTERNAL_APP_BASE_URL=http://127.0.0.1:3049` (defaults are derived from `PORT`).

## Local cron (replaces Vercel for dividend rollups)

[`src/instrumentation.ts`](src/instrumentation.ts) starts a lightweight scheduler when **not** on Vercel (`VERCEL !== "1"`): it `GET`s `/api/internal/dividend-models/roll` with `Authorization: Bearer <CRON_SECRET>` on an interval. Set **`CRON_SECRET`** in `.env.local` for this to run.

The hourly Schwab sync loop in [`src/lib/scheduler.ts`](src/lib/scheduler.ts) uses `INTERNAL_APP_BASE_URL` or `http://127.0.0.1:${PORT}`.

## Cold-start full data pull (market closed)

On local / desktop / non-Vercel Node startup, `src/lib/coldStartupDataPull.ts` runs **once per process** (~3.5s after bootstrap) **only while US equities RTH is closed**: Schwab holdings sync, taxonomy + market-cap refresh for all holdings, transaction history sync, Schwab quotes to `price_points`, Finnhub earnings sync, weekly portfolio snapshots, allocation daily close (**both** `auto`/`schwab`), and dividend-model rollup **when `CRON_SECRET` is set**. If RTH is open, this orchestration **skips** (live terminals rely on polling during the session).

Environment overrides:

- `COLD_STARTUP_PULL_DELAY_MS` — delay before the pull (default 3500).
- `FORCE_COLD_STARTUP_PULL_ON_VERCEL=1` — allow the orchestration on Vercel deployments (otherwise skipped to reduce serverless fan-out).

## Packaging notes

- **Bundled Node**: `npm run desktop:prepare` copies the `node` binary from the machine that runs the script. Build installers on the same OS/arch you target (or extend the script to download official Node tarballs per platform).
- **`npmRebuild`: false** in `package.json` `build`: native modules are **not** rebuilt for Electron; the UI shell does not load `better-sqlite3` directly.

## Code signing and distribution (release)

### macOS

1. Join the Apple Developer Program and create signing certificates.
2. Set environment variables for `electron-builder`, for example:
   - `CSC_LINK` — base64-encoded `.p12` export of your **Developer ID Application** certificate, or path to the keychain identity.
   - `CSC_KEY_PASSWORD` — password for the `.p12` file.
3. Remove or override `build.mac.identity: null` in [`package.json`](package.json) for release builds so `electron-builder` signs the `.app`.
4. Enable **notarization** (Apple requirement for Gatekeeper outside the Mac App Store):
   - `APPLE_ID`, `APPLE_APP_SPECIFIC_PASSWORD`, `APPLE_TEAM_ID` (or use `notarize: { teamId }` in config).

For local/ad-hoc testing only, `identity: null` keeps builds simple; users may need to right-click Open the first time.

### Windows

- Purchase a code-signing certificate (Authenticode). Set `CSC_LINK` / `CSC_KEY_PASSWORD` or configure `signtoolOptions` / `certificateFile` / `certificatePassword` per [electron-builder Windows code signing](https://www.electron.build/code-signing-win).
- Unsigned builds trigger SmartScreen warnings.

### Linux

- AppImage builds are typically not signed; distribute checksums and your own verification instructions.

## Troubleshooting

- **Blank window / timeout**: confirm `desktop/server-bundle/server.js` exists after `desktop:prepare`, and that nothing else uses the chosen port.
- **GUI launch on macOS without Node on PATH**: production builds use the copied `node` inside `server-bundle`; dev mode needs `node` on `PATH` or set `FINANCE_HUB_DEV_NODE` to an absolute path to the Node binary in `desktop/main.cjs`.
