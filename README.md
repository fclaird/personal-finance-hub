# Personal Finance Hub

Umbrella repository for the **Finance Hub** local personal finance dashboard and related tooling.

This repo defines the **project storage architecture** — where code, runtime data, and related projects live. The application was migrated from the legacy location on **2026-05-22**.

## Layout

```
personal-finance-hub/          ← this repo (source of truth for code + docs)
├── apps/
│   └── finance-hub/           ← Next.js + SQLite app (migration target)
├── docs/
│   ├── architecture/          ← storage and system design
│   └── migration/             ← cutover checklists and scripts
└── scripts/                   ← repo-level automation
```

## Runtime data (not in git)

All live data stays **outside** the repository:

| Path | Contents |
|------|----------|
| `~/.local/share/finance-hub/finance-hub.sqlite` | SQLite database |
| `~/.local/share/finance-hub/secrets.json.enc` | Encrypted Plaid/Schwab tokens |
| `~/.local/share/finance-hub/logs/` | Local logs (if enabled) |

The app resolves these paths via `APP_DIR_NAME = "finance-hub"` in `src/lib/paths.ts`. **Migration of the repo does not move or reset runtime data.**

## Related projects

| Project | Location | Relationship |
|---------|----------|--------------|
| **Finance Hub** (this repo) | `apps/finance-hub/` | Primary app — Schwab, allocation, options, dividends, terminal |
| **Simulated Dividend Portfolio** | `~/Projects/SimulatedDividendPortfolio` | Standalone spin-off — open-data dividend backtesting (no Schwab) |

## Legacy location (archived after migration)

The app previously lived at:

```
~/personal-finance-hub/finance-hub/
```

Remote: `https://github.com/fclaird/finance-hub.git`

**Current canonical path:** `apps/finance-hub/` in this repo.

See [docs/migration/from-legacy-finance-hub.md](docs/migration/from-legacy-finance-hub.md) for cutover notes.

## Quick start (after migration)

```bash
cd apps/finance-hub
cp .env.local.example .env.local   # fill in Schwab / Finnhub keys
npm install
npm run build && npm start         # same scheme as SCHWAB_REDIRECT_URI, on 127.0.0.1:3000
```

Day-to-day, run `apps/finance-hub/scripts/launch-financial-bridge.sh` (or point `~/bin/launch-financial-bridge.sh` at it). That checks `better-sqlite3` under the arm64 Node at `~/.local/opt/node-arm64` (rebuilds with the npm beside that Node only when `require` fails), builds when sources are newer than `.next`, and only then stops port 3000 and starts `node .next/standalone/server.js` (static and public assets copied beside it). A failed check or build leaves the current listener running. `… dev` keeps the dev server. `npm start` listens with the scheme in `SCHWAB_REDIRECT_URI`. An `https://127.0.0.1:3000/api/schwab/callback` URI serves HTTPS with the mkcert files `npm run dev` writes under `apps/finance-hub/certificates/`. An `http://` URI stays plain HTTP. Leave `FINANCE_HUB_ALLOW_BROKER_ORDERS` unset. Do not leave `npm run dev` running — Turbopack dev RSS grows to many GB.

On the Mac, the Dock launcher should be a one-line exec of that script. Interactive `npm` needs the arm64 Node first on `PATH`, then a native rebuild:

```bash
# ~/bin/launch-financial-bridge.sh
exec "$HOME/Projects/personal-finance-hub/apps/finance-hub/scripts/launch-financial-bridge.sh" "$@"

export PATH="$HOME/.local/opt/node-arm64/bin:$PATH"
hash -r
node -p "process.arch + ' ' + process.execPath"   # must print arm64
cd apps/finance-hub
npm install
npm rebuild better-sqlite3
node scripts/ensure-sqlite-native.mjs
```

If `~/.local/opt/node-arm64` is missing or is not arm64, the launcher falls back to Cursor's bundled arm64 Node, then to whatever `node` invoked the script. `FINANCE_HUB_NODE` overrides that. `FINANCE_HUB_REBUILD=1` forces a production build. `… start` skips the build.

From the repo root you can also run `npm run start` (delegates to `apps/finance-hub`).

Desktop shell: see `apps/finance-hub/docs/DESKTOP.md`.

## Documentation

- [Storage architecture](docs/architecture/storage.md) — full layout, boundaries, and conventions
- [Migration from legacy](docs/migration/from-legacy-finance-hub.md) — step-by-step cutover
