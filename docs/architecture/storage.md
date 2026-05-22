# Storage architecture

This document defines where **Personal Finance Hub** code, configuration, and runtime data live. The goal is a stable layout that survives repo moves, desktop packaging, and future package splits.

## Design principles

1. **Code in git; data on disk** — SQLite, OAuth tokens, and logs never belong in the repository.
2. **Single runtime data root** — One directory per machine (`~/.local/share/finance-hub/`) regardless of where the repo is checked out.
3. **Umbrella repo** — `personal-finance-hub` holds the app under `apps/` and leaves room for shared packages or tooling later.
4. **Spin-offs stay separate** — Features that no longer need Schwab or Finance Hub internals (e.g. Simulated Dividend Portfolio) live in their own repos under `~/Projects/`.

## Directory map

```
~/Projects/personal-finance-hub/                 # Git repository (umbrella)
│
├── apps/
│   └── finance-hub/                             # Primary application
│       ├── src/                                 # Next.js app + API routes
│       ├── desktop/                             # Electron shell + packaged builds
│       ├── scripts/                             # App-specific maintenance scripts
│       ├── docs/                                # App-specific docs (desktop, ingest, etc.)
│       ├── public/
│       ├── package.json
│       └── .env.local.example                   # Template only; real secrets in .env.local (gitignored)
│
├── docs/
│   ├── architecture/                            # Cross-cutting design (this file)
│   └── migration/                               # Cutover runbooks
│
└── scripts/                                     # Repo-level scripts (migration, sync)

~/.local/share/finance-hub/                      # Runtime data (NOT in git)
├── finance-hub.sqlite                           # Primary database
├── secrets.json.enc                             # Encrypted connector tokens
└── logs/                                        # Optional local logs

~/Projects/SimulatedDividendPortfolio/           # Related repo (standalone)
```

## Runtime data contract

Defined in `apps/finance-hub/src/lib/paths.ts`:

| Export | Path |
|--------|------|
| `getAppDataDir()` | `$HOME/.local/share/finance-hub` |
| `getDbPath()` | `…/finance-hub.sqlite` |
| `getSecretsPath()` | `…/secrets.json.enc` |

**Implications:**

- Cloning or moving the repo does **not** affect existing accounts, holdings, or tokens.
- Backups = copy `~/.local/share/finance-hub/` (or use in-app export if available).
- Multiple checkouts of the same repo share one database (usually desired for local-only use).

## Application layers (inside `apps/finance-hub`)

| Layer | Location | Responsibility |
|-------|----------|----------------|
| UI | `src/app/` | Next.js pages and client components |
| API | `src/app/api/` | HTTP routes (Schwab sync, allocation, terminal, etc.) |
| Connectors | `src/lib/connectors/` (and related) | Plaid, Schwab OAuth, file import |
| Analytics | `src/lib/analytics/`, domain libs | Allocation, options exposure, performance |
| Persistence | `src/lib/db.ts`, `src/db/schema.sql` | SQLite access and migrations |
| Scheduling | `src/lib/scheduler.ts`, `src/instrumentation-node.ts` | Local cron / cold-start pulls |

## Build artifacts (gitignored)

| Artifact | Typical path | Notes |
|----------|--------------|-------|
| Next dev/build | `apps/finance-hub/.next/` | Standard Next output |
| Desktop dev | `apps/finance-hub/.next-desktop/` | Parallel dev server for Electron |
| Desktop bundle | `apps/finance-hub/desktop/server-bundle/` | Standalone server copied for packaging |
| Desktop installers | `apps/finance-hub/desktop/out/` | DMG / unpacked `.app` |

## Environment configuration

| File | Committed? | Purpose |
|------|------------|---------|
| `.env.local.example` | Yes | Documents required keys |
| `.env.local` | No | Schwab, Finnhub, CRON_SECRET, redirect URIs |
| `vercel.json` | Yes | Legacy Vercel config; local/desktop ignores most of it |

Desktop OAuth redirect URIs must match the port Electron uses (default **3049**). See `apps/finance-hub/docs/DESKTOP.md`.

## Git remotes (target state after migration)

| Repo | Suggested remote | Contents |
|------|------------------|----------|
| `personal-finance-hub` | `github.com/<user>/personal-finance-hub` | Umbrella: app + docs + scripts |
| Legacy (retire after cutover) | `github.com/fclaird/finance-hub` | Historical; archive or redirect |

During transition, either:

- **Option A** — Point `finance-hub` remote history at `apps/finance-hub` via subtree or `git filter-repo`, preserving commits; or
- **Option B** — Fresh import with a tag on the last legacy commit (`legacy/pre-umbrella`).

See [../migration/from-legacy-finance-hub.md](../migration/from-legacy-finance-hub.md).

## Future extensions

Reserved paths (empty until needed):

```
packages/          # Shared TypeScript libraries extracted from finance-hub
tools/             # CLI utilities (backup, schema inspect, one-off migrations)
```

Do not add runtime data directories inside the repo (e.g. `data/` with real SQLite files).
