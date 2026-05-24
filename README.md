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
npm run dev                        # http://localhost:3000
```

From the repo root you can also run `npm run dev` (delegates to `apps/finance-hub`).

Desktop shell: see `apps/finance-hub/docs/DESKTOP.md`.

## Documentation

- [Storage architecture](docs/architecture/storage.md) — full layout, boundaries, and conventions
- [Migration from legacy](docs/migration/from-legacy-finance-hub.md) — step-by-step cutover
