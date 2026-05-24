# Personal Finance Hub — Codebase Audit

**Generated:** 2026-05-22  
**Scope:** Umbrella repo `personal-finance-hub` with canonical app at `apps/finance-hub/`  
**Purpose:** Architecture review, security posture, technical debt, and maintenance recommendations

---

## Executive summary

Finance Hub is a **local-first, single-user** personal finance dashboard built with **Next.js 16**, **React 19**, and **SQLite** (`better-sqlite3`). It integrates Charles Schwab (primary), optional Plaid, Yahoo Finance, Finnhub, SEC EDGAR, X/Twitter, and OpenAI for market data, portfolio analytics, a terminal-style UI, dividends, earnings, and alerts.

| Metric | Value |
|--------|-------|
| TypeScript/TSX source files | ~307 |
| Domain library modules (`src/lib/`) | ~171 |
| API route files | 87 |
| SQLite tables | 41 |
| Frontend pages | 17 |
| Unit test files | 10 |
| Largest page | `terminal/page.tsx` (~1,558 lines) |

**Strengths:** Clear domain separation under `src/lib/`, encrypted local secrets, WAL-mode SQLite, standalone Next.js output for Electron, recent manual-account / 529 bucket work is well-factored.

**Primary risks:**
1. **No API authentication** — designed for localhost; dangerous if exposed on a network (Tailscale, LAN, Vercel).
2. **Duplicate legacy code tree** at repo root (`src/`) alongside canonical `apps/finance-hub/src/`.
3. **Stale deployment config** — root `vercel.json` references a removed cron route.
4. **Low test coverage** relative to API surface (~10 unit files vs 87 route files).
5. **Schema drift** — dividend-model tables remain in SQLite though that feature moved to an external repo.

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
├── docs/                      Repo-level architecture & migration
├── scripts/                   Migration, digest PDF, backfill
├── src/                       ⚠ LEGACY DUPLICATE (93 API routes, dividend-models)
├── vercel.json                ⚠ Stale cron config
└── package.json               ⚠ Mirrors app; extra dividend-models test scripts
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

`apps/finance-hub/src/middleware.ts` — **only matches `/`**:
- Redirects to `/allocation` if cookie `fh_schwab_connected=1`
- Otherwise redirects to `/connections`
- **Not** a security gate; cookie is set after OAuth and is spoofable

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

## API surface (87 routes)

### Auth patterns

| Pattern | Routes | Notes |
|---------|--------|-------|
| **None (open)** | Majority of `/api/*` | Local-trust model |
| **`authorizeCronRequest`** | `/api/internal/*`, `/api/news/ingest` | Bearer, `x-cron-secret`, or `?secret=` |
| **OAuth callbacks** | `/api/schwab/*`, `/api/x/oauth/*` | State cookies + PKCE (X) |
| **JWT (report page)** | `/allocation/report?token=` | HS256 via `CRON_SECRET` / `ALLOC_REPORT_SECRET` |

### Routes by domain

#### Health & export
| Method | Path | Auth |
|--------|------|------|
| GET | `/api/health` | None — exposes DB path, starts scheduler |
| GET | `/api/export` | None — **full portfolio JSON dump** |

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

#### Data mode
| Method | Path |
|--------|------|
| GET, POST | `/api/data-mode` |

### Legacy-only routes (root `src/` — not in canonical app)

Full `/api/dividend-models/**` tree (~10 routes) and `/api/internal/dividend-models/roll` still exist in the duplicate root tree but **not** in `apps/finance-hub/`.

---

## Security audit

### Design assumption

The app is built for **single-user localhost** (or Electron on `127.0.0.1:3049`). Security relies on network isolation, not application-level auth.

### Secrets handling (good)

- OAuth tokens stored in `secrets.json.enc` at `~/.local/share/finance-hub/`
- Encrypted with AES-GCM; key derived via scrypt from `FINANCE_HUB_PASSPHRASE`
- AAD: `finance-hub-secrets` (`src/lib/crypto.ts`)
- Broker app credentials (`SCHWAB_*`, `PLAID_*`) read from env at runtime

### Findings

| Severity | Issue | Location / detail |
|----------|-------|-------------------|
| **Critical** | No API authentication | Any client reaching the server can read/write portfolio data |
| **Critical** | `/api/export` unauthenticated full dump | `src/app/api/export/route.ts` |
| **High** | Schwab/Plaid sync without auth | `POST /api/schwab/sync`, `/api/schwab/refresh`, `/api/plaid/sync` |
| **High** | Manual account CRUD without auth | `/api/manual/*` |
| **Medium** | X digest refresh triggers external APIs + OpenAI without cron check | `POST /api/terminal/x-digest/refresh` |
| **Medium** | `CRON_SECRET` accepted in query string | `src/lib/internalCronAuth.ts` — log/referrer leakage |
| **Medium** | `/api/health` exposes filesystem DB path | Information disclosure |
| **Low** | `fh_schwab_connected` cookie spoofable | Middleware redirect only |
| **Low** | Allocation report JWT uses shared secret | Depends on `CRON_SECRET` strength |
| **Ops** | Electron Mac build: `hardenedRuntime: false`, `identity: null` | `package.json` `build.mac` |

### If exposing beyond localhost (Tailscale, Vercel, LAN)

**Required before network exposure:**
1. Add session or API-key auth middleware for all `/api/*` routes
2. Protect write/sync endpoints explicitly
3. Remove or gate `/api/export`
4. Stop accepting cron secrets in query params
5. Rate-limit external API trigger routes (X refresh, earnings sync)

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
| `/terminal` | Market dashboard (~1,558 lines) | Yes |
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
| Manual accounts | `manual/manualAccounts.test.ts` | Partial (helpers + schema) |
| Schwab refresh | `refreshOrchestrator.test.ts`, `schwabGreeksRefresh.test.ts` | Covered |
| Dividends | 4 test files | Covered |
| News ingest | 2 test files | Covered |
| Format utils | `formatDate.test.ts` | Covered |
| **API routes** | — | **Not covered** |
| **Terminal UI** | — | **Not covered** |
| **OAuth flows** | — | **Not covered** |
| **Analytics (allocation, exposure)** | — | **Not covered** |
| **Portfolio glance** | — | **Not covered** |

Run tests:
```bash
cd apps/finance-hub
npx tsx --test src/lib/**/*.test.ts
npm run test:dividends  # dividends subset in package.json
```

### Lint & build

```bash
npm run lint    # ESLint 9
npm run build   # Next.js production build (passes as of audit date)
```

### Code quality observations

- **No TODO/FIXME** markers in application TS/TSX (clean)
- **Large files:** `terminal/page.tsx` (~1,558 lines) — maintenance burden; consider splitting into feature components
- **Duplicated repo tree:** Root `src/` mirrors much of `apps/finance-hub/src/` — drift risk
- **Schema dead weight:** Dividend model tables unused by canonical app
- **Shared snapshot helper:** `latestSnapshotIds` centralizes account scope — good recent refactor

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

Root `vercel.json`:
```json
{ "crons": [{ "path": "/api/internal/dividend-models/roll", "schedule": "15 7 * * *" }] }
```
**This route does not exist in the canonical app.** Cron will 404 if deployed from current tree.

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

### P0 — Do before any network exposure
1. Add authentication middleware for `/api/*`
2. Remove or protect `/api/export`
3. Audit all POST routes that trigger external API calls or data mutation

### P1 — Repo hygiene
1. **Delete or archive root `src/`** — eliminate duplicate tree (93 vs 87 routes)
2. **Fix `vercel.json`** — remove stale dividend-models cron or restore route
3. **Align root `package.json`** with `apps/finance-hub/package.json`
4. Document canonical path clearly in all docs (already in README; enforce in CI)

### P2 — Schema & product alignment
1. Drop or migrate unused dividend-model tables (or document as read-only legacy)
2. Consider formal migration files instead of inline `ALTER TABLE` patches
3. Add 529 as first-class bucket in diversification UI (currently Positions-only section)

### P3 — Quality & maintainability
1. Split `terminal/page.tsx` into feature modules
2. Add integration tests for critical API routes (positions, allocation, schwab sync)
3. Add tests for `portfolioGlance.ts`, `allocation.ts`, `optionsExposure.ts`
4. Move cron secret to header-only (drop `?secret=` support)
5. Redact DB path from `/api/health` in non-dev environments

### P4 — Nice to have
1. Consolidate duplicate `usePersistedColumnOrder.ts` (root vs app)
2. Add API route inventory to CI (count drift detection)
3. Electron: enable hardened runtime for Mac distribution

---

## Appendix: related projects

| Project | Location | Relationship |
|---------|----------|--------------|
| Finance Hub (this repo) | `apps/finance-hub/` | Primary app |
| Simulated Dividend Portfolio | `~/Projects/SimulatedDividendPortfolio` | Dividend backtesting spin-off |

---

## Appendix: audit methodology

- Static analysis of repo structure, schema, middleware, env templates
- Enumeration of all 87 API route files in `apps/finance-hub/src/app/api/`
- Comparison with legacy root `src/` tree
- Review of security-sensitive modules: `crypto.ts`, `internalCronAuth.ts`, OAuth flows
- Build verification: `npm run build` passes in `apps/finance-hub/`
- Unit tests: 7 tests across 2 new files (account buckets, manual accounts) + 8 existing files

---

*This document is intended for human review. Update after major refactors or before any deployment beyond localhost.*
