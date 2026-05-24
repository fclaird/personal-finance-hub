# Personal Finance Hub — Codebase Audit

**Generated:** 2026-05-22  
**Last updated:** 2026-05-24 (post-remediation)  
**Scope:** Umbrella repo `personal-finance-hub` with canonical app at `apps/finance-hub/`  
**Purpose:** Architecture review, security posture, technical debt, and maintenance recommendations

> **Note:** Sections below describe the pre-remediation baseline unless marked otherwise. See [Remediation status](#remediation-status-2026-05-24) at the end for what was completed.

---

## Executive summary

Finance Hub is a **local-first, single-user** personal finance dashboard built with **Next.js 16**, **React 19**, and **SQLite** (`better-sqlite3`). It integrates Charles Schwab (primary), optional Plaid, Yahoo Finance, Finnhub, SEC EDGAR, X/Twitter, and OpenAI for market data, portfolio analytics, a terminal-style UI, dividends, earnings, and alerts.

| Metric | Value (2026-05-24) |
|--------|---------------------|
| TypeScript/TSX source files | ~307 |
| Domain library modules (`src/lib/`) | ~171 |
| API route files | 88 |
| SQLite tables | 41 |
| Frontend pages | 17 |
| Unit test files | 15 |
| Largest page | `terminal/page.tsx` (~1,295 lines; split into feature panels) |

**Strengths:** Clear domain separation under `src/lib/`, encrypted local secrets, WAL-mode SQLite, standalone Next.js output for Electron, manual-account / 529 bucket work, opt-in LAN API auth, CI workflow.

**Remaining risks (post-remediation):**
1. **Opt-in API auth only** — safe on localhost by default; LAN/VPN exposure requires `FINANCE_HUB_API_KEY` (see `docs/security.md`).
2. **Low test coverage** relative to API surface (~15 unit files vs 88 route files).
3. **Schema drift** — dividend-model tables remain in SQLite though that feature moved to an external repo (documented as read-only).
4. **Electron Mac build** — `hardenedRuntime: false` (Phase 5 deferred).

---

## Repository layout

```
personal-finance-hub/
├── apps/finance-hub/          ← CANONICAL application (use this)
│   ├── src/app/               Pages + API routes
│   ├── src/lib/               Domain logic
│   ├── src/db/schema.sql      SQLite DDL
│   ├── desktop/               Electron shell
│   └── docs/                  App-specific docs
├── docs/                      Repo-level architecture, security, migration
├── scripts/                   Migration, digest PDF, backfill (repo-level)
├── vercel.json                Cron paths → allocation-daily-close, portfolio-snapshots/weekly
└── package.json               Delegates dev/build/test/lint to apps/finance-hub
```

### Runtime data (outside git)

| Path | Contents |
|------|----------|
| `~/.local/share/finance-hub/finance-hub.sqlite` | SQLite database |
| `~/.local/share/finance-hub/secrets.json.enc` | Encrypted OAuth tokens (Schwab, Plaid, X) |
| `~/.local/share/finance-hub/logs/` | Optional logs |

Resolved via `apps/finance-hub/src/lib/paths.ts` (`APP_DIR_NAME = "finance-hub"`).

---

## Technology stack

| Layer | Choice | Version |
|-------|--------|---------|
| Framework | Next.js (App Router, Turbopack) | 16.2.4 |
| UI | React | 19.2.4 |
| Styling | Tailwind CSS | 4.x |
| Charts | Recharts | 3.8.1 |
| Database | better-sqlite3 | ^12.9.0 |
| Validation | Zod | ^4.4.3 |
| JWT | jose | ^6.2.3 |
| Broker SDK | plaid | ^42.2.0 |
| Desktop | Electron + electron-builder | ^34.5.8 |
| Tests | Node built-in test runner + tsx | — |
| Lint | ESLint + eslint-config-next | 9 / 16.2.4 |

---

## Architecture

### Request flow

```
Browser / Electron
    → Next.js pages (mostly "use client")
    → fetch("/api/...")
    → route.ts handlers
    → src/lib/* domain modules
    → better-sqlite3 (getDb())
    → ~/.local/share/finance-hub/finance-hub.sqlite
```

External APIs (Schwab, Yahoo, Finnhub, X, OpenAI) are called from server-side lib modules and route handlers only. Client/server boundary is generally respected — manual account ID checks were split into `src/lib/manual/isManualAccountId.ts` to avoid bundling `better-sqlite3` in client components.

### Middleware

`apps/finance-hub/src/middleware.ts` matches `/` and `/api/:path*`:

- **`/`** — redirects to `/allocation` if cookie `fh_schwab_connected=1`, else `/connections` (cookie is spoofable; not a security gate)
- **`/api/*`** — when `FINANCE_HUB_API_KEY` is set, requires Bearer or `x-finance-hub-key`; OAuth callbacks and `/api/auth/config` exempt; cron routes accept `CRON_SECRET` at middleware (handler re-checks). See `docs/security.md`.

### Background scheduling

- `src/lib/scheduler.ts` — 60s Schwab refresh tick (slow full sync ~10 min)
- `src/instrumentation.ts` + `instrumentation-node.ts` — cold-start data pull (skipped on Vercel unless forced)
- Cron-protected internal routes for digest, allocation daily close, portfolio snapshots

### Data mode

Cookie `fh_data_mode`: `auto` (all synced accounts) | `schwab` (Schwab-only legacy filter). Affects analytics, terminal universe, portfolio glance, and exposure queries via `latestSnapshotIds(db, scope)`.

---

## Database

### Migration strategy

Single-file DDL (`src/db/schema.sql`) applied on startup, plus inline `ALTER TABLE` / `CREATE TABLE IF NOT EXISTS` patches in `src/lib/db.ts` `migrate()`. No numbered migration files beyond a `schema_migrations` bookkeeping row (`0001_init`).

**Implication:** Schema changes require careful ordering in `db.ts`; no rollback story.

### Table inventory (41 tables)

**Portfolio core**
- `institution_connections`, `accounts` (includes `account_bucket`: brokerage | retirement | 529)
- `securities`, `holding_snapshots`, `positions`, `option_greeks`
- `security_taxonomy`, `target_allocations`
- `alert_rules`, `alert_events`

**Market & performance**
- `price_points`, `account_value_points`, `portfolio_snapshots`, `ohlcv_points`
- `allocation_daily_underlying`, `option_flow_daily`

**Cashflows & earnings**
- `cashflows`, `earnings_events`, `earnings_opp_metrics`

**Dividends**
- Live book: `dividend_book_meta`, `dividend_book_forward_snap`
- Legacy modeling (schema retained, UI removed): `dividend_model_*`, `symbol_monthly_market`, etc.

**Broker & terminal**
- `broker_transactions`, `schwab_refresh_runs`
- `symbol_notes`, `symbol_issuer_narrative`, `symbol_narrative_override`
- `news_feed_items`, `x_digest_cache`, `x_symbol_cache`

**Ops**
- `schema_migrations`

### Manual external accounts

- Connection ID: `conn_manual`
- Account IDs: `manual_*` prefix
- Positions stored in standard `positions` table with `metadata_json`: `{ source: "manual", purchaseDate, notes }`
- Included in combined net views via `latestSnapshotIds(db, "all_synced")`
- 529 accounts appear on Positions page; excluded from brokerage/retirement analytics splits

### Account buckets

`apps/finance-hub/src/lib/accountBuckets.ts`:
- Explicit column `accounts.account_bucket` takes precedence
- Heuristics from name/nickname: `\b529\b`, `\bIRA\b`, `\b(401k|403b|457|roth|sep|pension|retire)\b`
- Used in Positions grouping, allocation/exposure bucket APIs, performance series

---

## API surface (88 routes)

### Auth patterns

| Pattern | Routes | Notes |
|---------|--------|-------|
| **Open (default)** | Majority of `/api/*` | When `FINANCE_HUB_API_KEY` unset — localhost trust |
| **`FINANCE_HUB_API_KEY`** | All `/api/*` via middleware | Opt-in LAN/VPN; UI prompts via `ApiKeyProvider` |
| **`authorizeCronRequest`** | `/api/internal/*`, `/api/news/ingest` | Bearer or `x-cron-secret` only (no query string); also accepted at middleware when LAN auth on |
| **OAuth callbacks** | `/api/schwab/callback`, `/api/x/oauth/callback` | Exempt from API key |
| **JWT (report page)** | `/allocation/report?token=` | HS256 via `CRON_SECRET` / `ALLOC_REPORT_SECRET` |

### Routes by domain

#### Health & export
| Method | Path | Auth |
|--------|------|------|
| GET | `/api/health` | Starts scheduler; DB path redacted when `NODE_ENV=production` |
| GET | `/api/export` | Full portfolio JSON dump — protect when LAN auth enabled |

#### Accounts & manual
| Method | Path |
|--------|------|
| GET | `/api/accounts` |
| POST | `/api/accounts/nickname` |
| POST | `/api/manual/accounts` |
| PATCH, DELETE | `/api/manual/accounts/[id]` |
| POST | `/api/manual/accounts/[id]/positions` |
| DELETE | `/api/manual/positions/[positionId]` |

#### Positions & quotes
| Method | Path |
|--------|------|
| GET | `/api/positions` |
| POST | `/api/quotes` |

#### Schwab (13 route files)
| Method | Path |
|--------|------|
| GET | `/api/schwab/start`, `/api/schwab/callback`, `/api/schwab/status` |
| POST | `/api/schwab/sync`, `/api/schwab/refresh`, `/api/schwab/refresh-greeks`, `/api/schwab/quotes` |
| GET | `/api/schwab/refresh-status` |
| POST | `/api/schwab/transactions/sync`, `/api/schwab/account-value/sync` |

#### Plaid
| Method | Path |
|--------|------|
| POST | `/api/plaid/link-token`, `/api/plaid/exchange`, `/api/plaid/sync` |

#### Allocation & exposure
| Method | Path |
|--------|------|
| GET | `/api/allocation`, `/api/allocation/page-data`, `/api/allocation/accounts`, `/api/allocation/buckets`, `/api/allocation/underlying-history` |
| GET | `/api/exposure`, `/api/exposure/details`, `/api/exposure/buckets` |

#### Performance
| Method | Path |
|--------|------|
| GET, POST | `/api/performance` |
| GET | `/api/performance/today`, `/api/performance/history`, `/api/performance/benchmarks` |

#### Dividends (live Schwab book)
| Method | Path |
|--------|------|
| GET | `/api/dividends/book`, `/api/dividends/dashboard`, `/api/dividends/holdings`, `/api/dividends/summary`, `/api/dividends/timeline`, `/api/dividends/timeseries` |
| POST | `/api/dividends/refresh-live` |

#### Earnings
| Method | Path |
|--------|------|
| GET | `/api/earnings` |
| POST | `/api/earnings/sync`, `/api/earnings/enrich-schwab` |

#### Strategies
| Method | Path |
|--------|------|
| GET | `/api/strategy-trades` |
| POST | `/api/strategy-trades/reclassify` |

#### Terminal (18 route files)
| Method | Path |
|--------|------|
| GET | `/api/terminal/us-markets`, `/api/terminal/movers`, `/api/terminal/heatmap`, `/api/terminal/candles`, `/api/terminal/universe`, `/api/terminal/company`, `/api/terminal/futures`, `/api/terminal/news`, `/api/terminal/option-flow`, `/api/terminal/x-digest`, `/api/terminal/x-symbol` |
| POST | `/api/terminal/bootstrap`, `/api/terminal/company-batch`, `/api/terminal/volume-anomalies` |
| GET, PUT | `/api/terminal/symbol-notes` |
| POST | `/api/terminal/x-digest/refresh`, `/api/terminal/x-symbol/refresh` |

#### X OAuth
| Method | Path |
|--------|------|
| GET | `/api/x/oauth/start`, `/api/x/oauth/callback`, `/api/x/status` |

#### Watchlists, taxonomy, targets, rebalancing, alerts, posterity
| Method | Path |
|--------|------|
| GET, POST | `/api/watchlists`, `/api/watchlists/items` |
| GET | `/api/taxonomy` |
| POST | `/api/taxonomy/sync` |
| GET, POST | `/api/targets` |
| GET | `/api/rebalancing` |
| GET, POST | `/api/alerts/rules` |
| GET | `/api/alerts/events` |
| POST | `/api/alerts/run` |
| GET | `/api/posterity/accounts`, `/api/posterity/positions`, `/api/posterity/exposure` |

#### News & symbols
| Method | Path |
|--------|------|
| POST | `/api/news/ingest` (cron auth) |
| GET | `/api/symbols/story` |

#### Internal (cron-protected)
| Method | Path |
|--------|------|
| GET | `/api/internal/allocation-digest` |
| POST | `/api/internal/allocation-digest/notify` |
| POST | `/api/internal/allocation-daily-close` |
| POST | `/api/internal/portfolio-snapshots/weekly` |
| GET, POST | `/api/internal/x-digest/refresh` |

#### Data mode & auth config
| Method | Path |
|--------|------|
| GET, POST | `/api/data-mode` |
| GET | `/api/auth/config` |

### Removed legacy routes

The in-app `/api/dividend-models/**` tree and root duplicate `src/` were removed in Phase 1 remediation. Dividend backtesting lives in the external Simulated Dividend Portfolio repo.

---

## Security audit

### Design assumption

The app is built for **single-user localhost** (or Electron on `127.0.0.1:3049`). Security relies on network isolation, not application-level auth.

### Secrets handling (good)

- OAuth tokens stored in `secrets.json.enc` at `~/.local/share/finance-hub/`
- Encrypted with AES-GCM; key derived via scrypt from `FINANCE_HUB_PASSPHRASE`
- AAD: `finance-hub-secrets` (`src/lib/crypto.ts`)
- Broker app credentials (`SCHWAB_*`, `PLAID_*`) read from env at runtime

### Findings (original audit) and remediation

| Severity | Issue | Status |
|----------|-------|--------|
| **Critical** | No API authentication | **Mitigated** — opt-in `FINANCE_HUB_API_KEY` middleware (`docs/security.md`) |
| **Critical** | `/api/export` unauthenticated full dump | **Mitigated** when LAN auth enabled (middleware gates all `/api/*`) |
| **High** | Schwab/Plaid sync without auth | **Mitigated** when LAN auth enabled |
| **High** | Manual account CRUD without auth | **Mitigated** when LAN auth enabled |
| **Medium** | X digest refresh without cron check | **Open** — `POST /api/terminal/x-digest/refresh` is user-triggered |
| **Medium** | `CRON_SECRET` in query string | **Fixed** — header-only in `internalCronAuth.ts` |
| **Medium** | `/api/health` exposes DB path | **Fixed** — redacted in production |
| **Low** | `fh_schwab_connected` cookie spoofable | **Open** — redirect only |
| **Low** | Allocation report JWT uses shared secret | **Open** — depends on secret strength |
| **Ops** | Electron Mac: `hardenedRuntime: false` | **Deferred** (Phase 5) |

### If exposing beyond localhost (Tailscale, Vercel, LAN)

See **`docs/security.md`** checklist. Set `FINANCE_HUB_API_KEY` before binding to LAN/VPN. Cron jobs use `CRON_SECRET` (accepted at middleware on internal routes).

---

## External integrations

| Provider | Purpose | Key modules |
|----------|---------|-------------|
| **Charles Schwab** | OAuth, holdings, quotes, greeks, transactions, candles | `src/lib/schwab/*` |
| **Plaid** | Optional link/exchange/sync | `src/lib/plaid/*` |
| **Yahoo Finance** | Charts, dividends, asset profiles, portfolio glance fallback | `src/lib/market/yahoo*.ts` |
| **Finnhub** | Earnings calendar, volume | `src/lib/earnings/finnhub.ts` |
| **SEC EDGAR** | Filing excerpts, CIK lookup | `src/lib/sec/*`, `src/lib/openData/*` |
| **X (Twitter) API v2** | Timeline digest, per-symbol posts | `src/lib/x/*` |
| **OpenAI** | X digest summarization (optional) | `src/lib/x/digest.ts` |
| **Twilio / Resend** | Digest SMS/email | `/api/internal/allocation-digest/notify` |
| **RSS** | Terminal news fallback | `NEWS_RSS_FEEDS` env |
| **OpenFIGI / Wikidata** | Symbol narratives | `src/lib/symbolStory/*`, `src/lib/openData/*` |
| **iOS Shortcut** | News ingest POST | `/api/news/ingest` |

---

## Frontend

### Pages (17)

| Route | Purpose | In sidebar |
|-------|---------|------------|
| `/` | Redirect only (middleware) | — |
| `/connections` | Schwab/Plaid OAuth setup | — |
| `/terminal` | Market dashboard (~1,295 lines; feature panels extracted) | Yes |
| `/terminal/watchlists` | Watchlist management | Via terminal |
| `/terminal/symbol/[symbol]` | Symbol detail | Via terminal |
| `/positions` | Holdings + manual accounts | Yes |
| `/strategies`, `/strategies/[category]` | Option strategy trades | Yes |
| `/allocation` | Asset class allocation | Yes |
| `/allocation/report` | JWT/cron-linked report | No |
| `/diversification` | Underlying exposure | Yes |
| `/earnings` | Earnings calendar | Yes |
| `/performance` | Portfolio value history | Yes |
| `/dividends` | Dividend book dashboard | Yes |
| `/rebalancing` | Target vs actual | Yes |
| `/alerts` | Alert rules & events | Yes |
| `/posterity` | Filtered legacy accounts | Yes |

Sidebar nav defined in `src/app/lib/sidebarNav.ts` (11 items).

### Notable components

| Component | Role |
|-----------|------|
| `ManualAccountDialogs.tsx` | External account + holding CRUD (Brokerage/Retirement/529) |
| `PositionsGroupedTable.tsx` | Grouped holdings with manual columns |
| `terminal/TerminalPositionTreemap.tsx` | Portfolio treemap |
| `allocation/AllocationWeightingChart.tsx` | Allocation charts |
| `charts/ExposurePositionTreemap.tsx` | Exposure visualization |
| `DraggableTileLayout.tsx` | Terminal tile layout |
| `SidebarNav.tsx` | App navigation |

### UX patterns

- Heavy client-side fetching with market-aware polling (`useMarketAwareInterval`)
- Schwab refresh coordinator hook (`useSchwabRefreshCoordinator`)
- Privacy mode masks sensitive values (`src/lib/format.ts` → `"XXXXX"`)
- Demo mode via `demo_%` accounts and demo earnings sync

---

## Domain library map (`src/lib/`)

| Module | Responsibility |
|--------|----------------|
| `schwab/` | OAuth, sync, quotes, greeks, refresh orchestration |
| `analytics/` | Allocation, exposure, performance, options delta |
| `terminal/` | Portfolio glance, universe, OHLCV, movers, option flow |
| `dividends/` | Schwab dividend book, enrichment, categories |
| `earnings/` | Finnhub sync, universe, opp metrics |
| `manual/` | External account CRUD |
| `holdings/` | `latestSnapshotIds` shared query helper |
| `accountBuckets.ts` | Brokerage / retirement / 529 resolution |
| `plaid/` | Link token, exchange, sync |
| `x/` | OAuth, digest, symbol cache |
| `market/` | Session windows, Yahoo/Schwab quote display |
| `news/` | Ingest parsing, symbol matching |
| `symbolStory/` | Issuer narratives from open data |
| `sec/` | EDGAR filing fetch |
| `db.ts`, `paths.ts`, `crypto.ts`, `env.ts` | Infrastructure |

---

## Testing & quality

### Test coverage

| Area | Files | Status |
|------|-------|--------|
| Account buckets | `accountBuckets.test.ts` | Covered |
| Manual accounts | `manual/manualAccounts.test.ts` | Covered (CRUD + delete cascade) |
| Allocation | `analytics/allocation.test.ts` | Covered |
| Portfolio glance | `terminal/portfolioGlance.test.ts` | Covered |
| Latest snapshots | `holdings/latestSnapshots.test.ts` | Covered |
| API auth | `apiAuth.test.ts` | Covered |
| Market glance charts | `market/usMarketIndices.test.ts` | Covered |
| Schwab refresh | `refreshOrchestrator.test.ts`, `schwabGreeksRefresh.test.ts` | Covered |
| Dividends | 4 test files | Covered |
| News ingest | 2 test files | Covered |
| Format utils | `formatDate.test.ts` | Covered |
| **API route handlers** | — | Not covered (integration gap) |
| **OAuth flows** | — | Not covered |

Run tests:
```bash
cd apps/finance-hub && npm run test
# or from repo root:
npm test
```

CI: `.github/workflows/ci.yml` — build, test, lint, API route count check.

### Lint & build

```bash
npm run lint    # ESLint 9
npm run build   # Next.js production build (passes as of audit date)
```

### Code quality observations

- **No TODO/FIXME** markers in application TS/TSX (clean)
- **Terminal page** partially split into `src/app/components/terminal/*` panels
- **Schema dead weight:** Dividend model tables unused by UI (documented read-only in `docs/architecture/storage.md`)
- **Shared snapshot helper:** `latestSnapshotIds` centralizes account scope; consolidated allocation uses per-account latest snapshots

---

## Build & deployment

### Next.js config (`next.config.ts`)

- `output: "standalone"` for Electron packaging
- `serverExternalPackages: ["better-sqlite3"]`
- Electron dev uses `.next-desktop` dist dir when `FINANCE_HUB_ELECTRON_DEV=1`

### Electron desktop

- Entry: `desktop/main.cjs`
- Default port: **3049** (`INTERNAL_APP_BASE_URL=http://127.0.0.1:3049`)
- Pack: `npm run desktop:dist` → `desktop/out/`
- Docs: `apps/finance-hub/docs/DESKTOP.md`

### Vercel / cloud

Root `vercel.json` crons (post-remediation):
```json
{
  "crons": [
    { "path": "/api/internal/allocation-daily-close", "schedule": "0 21 * * 1-5" },
    { "path": "/api/internal/portfolio-snapshots/weekly", "schedule": "0 22 * * 0" }
  ]
}
```

When deploying with `FINANCE_HUB_API_KEY`, configure Vercel cron invocations to send `Authorization: Bearer <CRON_SECRET>` (or exempt via middleware — cron secret is accepted on internal paths).

Cold-start instrumentation skips Vercel by default unless `FORCE_COLD_STARTUP_PULL_ON_VERCEL=1`.

### Required environment variables

**Core (Schwab)**
- `FINANCE_HUB_PASSPHRASE`
- `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET`, `SCHWAB_REDIRECT_URI`

**Optional connectors**
- `PLAID_CLIENT_ID`, `PLAID_SECRET`, `PLAID_ENV`
- `FINNHUB_API_KEY`, `EARNINGS_WATCHLIST`
- `X_CLIENT_ID`, `X_CLIENT_SECRET`, `X_REDIRECT_URI`
- `OPENAI_API_KEY`, `OPENAI_MODEL`

**Cron / digest / mobile access**
- `CRON_SECRET`, `ALLOC_REPORT_SECRET`, `PUBLIC_APP_URL`, `INTERNAL_APP_BASE_URL`
- `TWILIO_*`, `DIGEST_SMS_TO`, `RESEND_API_KEY`, `DIGEST_EMAIL_*`

**Terminal / ops**
- `TERMINAL_FUTURES_SYMBOLS`, `NEWS_RSS_FEEDS`
- `FINANCE_HUB_API_KEY`, `FINANCE_HUB_BIND_HOST` (LAN/VPN — see `docs/security.md`)
- `SCHWAB_RTH_FULL_SYNC`, `COLD_STARTUP_PULL_DELAY_MS`

Template: `apps/finance-hub/.env.local.example`

---

## Recent feature areas (2026)

### Manual external accounts
- CRUD for accounts outside Schwab (Fidelity, 529 plans, etc.)
- Fields: symbol, quantity, purchase date/price, market value, cash
- API: `/api/manual/*`
- UI: Positions page → "Add external account"

### Account buckets (Brokerage / Retirement / 529)
- `accounts.account_bucket` column with migration in `db.ts`
- Explicit bucket picker in manual account dialog
- 529 section on Positions page
- Included in combined net (terminal portfolio, performance Combined)
- Excluded from brokerage/retirement analytics splits

### Terminal portfolio glance
- Live day % from `quantity × quote price` (not stale MV weights)
- Includes cash and all holdings across synced accounts
- Schwab quotes + Yahoo intraday fallback
- `src/lib/terminal/portfolioGlance.ts`

### Option flow history
- `option_flow_daily` table
- Vol / Opt× toggle on terminal

---

## Prioritized recommendations

### P0 — Do before any network exposure ✅ (2026-05-24)
1. ~~Add authentication middleware for `/api/*`~~ — Done (`FINANCE_HUB_API_KEY`)
2. ~~Protect `/api/export`~~ — Gated when LAN auth enabled
3. Audit POST routes that trigger external APIs — partial; X digest refresh still user-open

### P1 — Repo hygiene ✅ (2026-05-24)
1. ~~Delete root `src/`~~ — Done
2. ~~Fix `vercel.json`~~ — Done
3. ~~Align root `package.json`~~ — Done
4. ~~CI API route count~~ — Done (`.github/workflows/ci.yml`)

### P2 — Schema & product alignment (partial)
1. ~~Document dividend-model tables as read-only~~ — Done (`docs/architecture/storage.md`)
2. Formal migration files — deferred
3. ~~529 in diversification UI~~ — Done

### P3 — Quality & maintainability (partial)
1. ~~Split `terminal/page.tsx`~~ — Partial (quick glance panels extracted)
2. Integration tests for API routes — deferred
3. ~~Tests for portfolioGlance, allocation~~ — Done
4. ~~Cron secret header-only~~ — Done
5. ~~Redact DB path from `/api/health` in production~~ — Done

### P4 — Nice to have (partial)
1. ~~Consolidate duplicate `usePersistedColumnOrder.ts`~~ — root copy removed with legacy tree
2. ~~API route inventory in CI~~ — Done
3. Electron hardened runtime — deferred
4. Rate-limit mutating routes when LAN auth on — deferred

---

## Appendix: related projects

| Project | Location | Relationship |
|---------|----------|--------------|
| Finance Hub (this repo) | `apps/finance-hub/` | Primary app |
| Simulated Dividend Portfolio | `~/Projects/SimulatedDividendPortfolio` | Dividend backtesting spin-off |

---

## Appendix: audit methodology

- Static analysis of repo structure, schema, middleware, env templates
- Enumeration of API route files in `apps/finance-hub/src/app/api/` (88 as of 2026-05-24)
- Review of security-sensitive modules: `crypto.ts`, `internalCronAuth.ts`, `apiAuth.ts`, OAuth flows
- Build verification: `npm run build` passes in `apps/finance-hub/`
- Unit tests: 50+ assertions across 15 test files (run via `npm run test`)

---

*This document is intended for human review. Update after major refactors or before any deployment beyond localhost.*

---

## Remediation status (2026-05-24)

| Phase | Status | Notes |
|-------|--------|-------|
| Phase 1 — Repo consolidation | Done | Root `src/`, `public/`, duplicate configs removed; root `package.json` delegates to `apps/finance-hub`; `vercel.json` crons fixed |
| Phase 2 — LAN-ready security | Done | Opt-in `FINANCE_HUB_API_KEY` middleware; cron routes accept `CRON_SECRET` at middleware; cron header-only auth in handlers; production health redaction; `docs/security.md` |
| Phase 3 — Schema + 529 UI | Done | 529 bucket in diversification/allocation/terminal; legacy dividend tables documented in `docs/architecture/storage.md` |
| Phase 4 — Tests + CI | Done | Tests for snapshots, allocation buckets, portfolio glance, manual CRUD; terminal page split; `.github/workflows/ci.yml` |
