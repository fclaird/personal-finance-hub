# Plan: Market-close Terminal digest to phone

**Status:** Planned (not implemented)  
**Goal:** At US equity market close, deliver **Terminal quick glance** and **portfolio treemap** to your phone without SMS vendors (no Twilio). Prefer Apple-native delivery (iCloud, iMessage) or pull-based iOS Shortcuts.

**Related docs:** [mobile-access-and-digest.md](../mobile-access-and-digest.md) (Tailscale, launchd, allocation digest — different product), [CACTUSJXCK_NEWS_INGEST.md](../../apps/finance-hub/docs/CACTUSJXCK_NEWS_INGEST.md) (iOS Shortcut → hub pattern).

---

## Scope

| Deliverable | UI location | Data source today |
|-------------|-------------|-------------------|
| Quick glance (Portfolio, SPY, QQQ, …) | Terminal | `GET /api/terminal/us-markets` → `fetchPortfolioGlanceCard` |
| Portfolio treemap (colored by day %) | Terminal → `PortfolioTreemapSection` | `GET /api/terminal/heatmap?view=portfolio` (JSON; chart is client Recharts) |
| Performance line chart (optional) | `/performance` | `GET /api/performance/history` — **not** a treemap; include only if desired |

Treemap is **visual**; JSON APIs alone cannot reproduce the chart on the phone without a screenshot/PDF step or a new text summary formatter.

---

## Constraints

- No Twilio (and ideally no paid SMS/push vendors).
- Hub runs locally on Mac (Electron or `npm run start`); not assumed to be on Vercel for delivery.
- Portfolio data is sensitive — reuse existing auth: `CRON_SECRET`, optional `FINANCE_HUB_API_KEY`, optional JWT report tokens (see allocation report pattern).

---

## What already exists

- **Allocation digest** (different feature): `buildAllocationDigest`, `POST /api/internal/allocation-digest/notify` (Twilio + Resend), `npm run digest:pdf` via Playwright on `/allocation/report?token=…`.
- **Phone reachability:** Tailscale / tunnel guidance in `docs/mobile-access-and-digest.md`.
- **Scheduling examples:** launchd plist in that doc; Vercel cron for allocation daily close (`vercel.json` `0 21 * * 1-5` UTC — note EDT offset).
- **Session helpers:** `isUsEquityRegularSessionOpen`, `usEquitySessionStatus` in `src/lib/market/usEquitySession.ts`.
- **Close-time data refresh:** `coldStartupDataPull.ts`, `scheduler.ts` Schwab closed bundle — data can be fresh before send, but nothing pushes Terminal views today.
- **iOS Shortcut precedent:** news ingest POST with `CRON_SECRET`.

**Gap:** No `/api/internal/market-close-digest`, no tokenized Terminal print page, no Playwright script for Terminal, no launchd job for market close.

---

## Recommended approach (phased)

### Phase A — Mac scheduler + visuals (best treemap on phone)

1. **Schedule on Mac** (~4:05 PM America/New_York, weekdays): launchd job or shell wrapper that:
   - Skips NYSE holidays / weekends via `usEquitySession` helpers (do not rely on fixed UTC cron alone).
   - Optionally triggers Schwab closed refresh (wait for sync) before capture.
2. **Capture:** Playwright script (mirror `apps/finance-hub/scripts/pdf-allocation-report.ts`):
   - Mint short-lived JWT (reuse `signAllocationReportToken` pattern or new `TERMINAL_REPORT_SECRET`).
   - Open tokenized page that renders glance + treemap with **default** treemap prefs (avoid localStorage-dependent layout on server render), **or** screenshot authenticated `/terminal` after login cookie (harder).
   - Export **PNG** (and optional PDF).
3. **Deliver:**
   - **Primary:** Save to iCloud Drive folder (`~/Library/Mobile Documents/com~apple~CloudDocs/Finance Hub/…`) — syncs to iPhone Files.
   - **Optional:** Attach PNG via macOS **iMessage** (AppleScript / Shortcuts “Send Message”) to self.

### Phase B — Text summary (no screenshot)

1. New **`buildMarketCloseDigest()`** using existing libs:
   - Glance: portfolio + index day % from `us-markets` payload shape.
   - Treemap proxy: top/bottom N symbols from heatmap JSON (`changePercent`, symbol, portfolio MV).
   - Optional: `/api/performance/today` for cross-check portfolio %.
2. **`POST /api/internal/market-close-digest/notify`** (auth: `CRON_SECRET`):
   - Body: `{ sendIcloud: false, sendImessage: true }` or return JSON for external script.
   - **No Twilio** — Mac-side script formats SMS-length text and sends via iMessage.
3. Reuse SMS policy from allocation digest if ever adding carrier SMS later: percentages in short text; full numbers only in email/PDF.

### Phase C — Phone pull (no Mac cron)

1. Tailscale + `FINANCE_HUB_API_KEY` on hub.
2. iOS **Personal Automation**: ~4:05 PM weekdays → Shortcut GETs `/api/terminal/us-markets` + `/api/terminal/heatmap` → **Show Notification**.
3. Limitations: no NYSE holiday awareness; no treemap image; HTTPS cert quirks with `npm run dev --experimental-https` (prefer `npm run start` + HTTP on tailnet).

---

## Alternative options (lower priority)

| Option | Pros | Cons |
|--------|------|------|
| Resend email only (`allocation-digest/notify` with `sendSms: false`) | HTML, already coded for allocation | Third-party; treemap needs image embed |
| Self-hosted **ntfy** / Gotify | Push with image URL | Extra service to run |
| Extend Vercel cron | Hands-off if deployed | Wrong product today; EDT vs EST; local SQLite |

---

## Implementation checklist

### Backend / app

- [ ] `src/lib/marketCloseDigest.ts` — `buildMarketCloseDigest()`, `formatMarketCloseDigestText()`, optional HTML.
- [ ] `GET /api/internal/market-close-digest` — JSON snapshot (CRON auth).
- [ ] `POST /api/internal/market-close-digest/notify` — orchestrate capture + return paths for Mac script (or shell out hooks documented, not Twilio).
- [ ] Tokenized **`/terminal/close-report`** (or `/internal/terminal-report`) — server-friendly layout: glance cards + static treemap from heatmap data (SSR or RSC), no drag prefs from localStorage.
- [ ] `signTerminalReportToken` or reuse allocation token with distinct path claim.

### Scripts / ops

- [ ] `apps/finance-hub/scripts/screenshot-terminal-close-report.ts` — Playwright PNG/PDF (env: `PUBLIC_APP_URL`, `CRON_SECRET`, `MARKET_CLOSE_PNG_PATH`, optional iCloud output dir).
- [ ] `scripts/market-close-digest.sh` — wait for session closed → optional refresh POST → screenshot → copy to iCloud → optional iMessage.
- [ ] `~/Library/LaunchAgents/com.financehub.market-close-digest.plist` — **NY timezone–aware** schedule (wrapper script checks session, not blind 21:00 UTC).
- [ ] Document env vars in this file and link from `mobile-access-and-digest.md` when implemented.

### Tests

- [ ] Unit tests for digest text formatter (top/bottom movers, portfolio % formatting).
- [ ] Smoke: manual `curl` against digest JSON; manual Playwright run with server up.

### Security

- [ ] Report tokens short TTL (e.g. 10–15 min).
- [ ] Do not log portfolio values in server logs.
- [ ] If exposing via Tailscale, set `FINANCE_HUB_API_KEY`.

---

## Environment variables (planned)

| Variable | Purpose |
|----------|---------|
| `CRON_SECRET` | Auth for internal digest routes (existing) |
| `PUBLIC_APP_URL` | Base URL for Playwright (Tailscale IP or `http://127.0.0.1:3000`) |
| `ALLOC_REPORT_SECRET` or new `TERMINAL_REPORT_SECRET` | JWT signing for close-report page |
| `FINANCE_HUB_API_KEY` | Required if hub bound beyond localhost |
| `MARKET_CLOSE_PNG_PATH` | Output path for screenshot script |
| `MARKET_CLOSE_ICLOUD_DIR` | Optional iCloud Drive destination |
| `DIGEST_IMESSAGE_TO` | Optional E.164 or Apple ID for Mac iMessage script |

**Explicitly out of scope for this plan:** `TWILIO_*`, `DIGEST_SMS_TO`, `RESEND_*` (unless user opts into email later).

---

## Market close timing notes

- NYSE RTH: Mon–Fri 09:30–16:00 **America/New_York** (`usEquitySession.ts`).
- Run capture **after** 16:00 NY and **after** Schwab closed refresh (~4:05–4:15 PM buffer).
- Existing Vercel cron `0 21 * * 1-5` UTC ≈ 16:00 **EST** but **17:00 EDT** — do not reuse for Terminal close without NY-local scheduling.

---

## Suggested default for execution

**Phase A + B together:** iCloud PNG of glance + treemap **plus** one-line iMessage summary from JSON APIs. No Twilio, treemap visible on phone, Mac must be on at close.

When ready to implement, start with **`buildMarketCloseDigest` + JSON route** (quick win), then **tokenized close-report page + Playwright script**, then **launchd plist**.
