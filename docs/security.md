# Finance Hub — Security and network access

Finance Hub is a **single-user, local-first** app. By default it binds to **127.0.0.1** and does not require API authentication.

## Default posture (localhost / Electron)

- Dev server: `127.0.0.1` via [`scripts/dev.mjs`](../apps/finance-hub/scripts/dev.mjs)
- Electron desktop: `127.0.0.1:3049` via [`desktop/main.cjs`](../apps/finance-hub/desktop/main.cjs)
- No `FINANCE_HUB_API_KEY` → all `/api/*` routes open (trust the network boundary)

## Before enabling LAN or VPN access

Complete this checklist **before** binding to `0.0.0.0` or exposing the app via Tailscale, LAN, or a VPN tunnel:

1. **Set an API key** in `.env.local`:
   ```bash
   FINANCE_HUB_API_KEY="generate-a-long-random-string"
   ```
   When set, middleware requires `Authorization: Bearer <key>` or `x-finance-hub-key` on all `/api/*` except OAuth callbacks, `/api/auth/config`, and cron-protected routes (see below).

2. **Bind intentionally** (only if remote devices need direct HTTP access):
   ```bash
   FINANCE_HUB_BIND_HOST="0.0.0.0"
   ```
   Prefer Tailscale/VPN so traffic stays on a private network.

3. **Set cron secret** for internal jobs (digest, snapshots):
   ```bash
   CRON_SECRET="separate-long-random-string"
   ```
   Use Bearer header only — query-string secrets are not supported.

4. **Do not expose `/api/export`** to untrusted clients — it dumps the full portfolio.

5. **Use HTTPS** where possible (Tailscale MagicDNS HTTPS or reverse proxy) when accessing from phones.

## Client API key flow

When `FINANCE_HUB_API_KEY` is set, the UI shows a one-time prompt (stored in `sessionStorage` for the browser tab). All `fetch` calls are patched to include the Bearer token.

## OAuth callbacks (exempt from API key)

- `/api/schwab/callback`
- `/api/x/oauth/callback`

These must remain reachable for broker OAuth redirects.

## Cron / internal routes (when LAN auth is enabled)

When `FINANCE_HUB_API_KEY` is set, middleware still allows requests to cron-protected routes if they present a valid `CRON_SECRET` via `Authorization: Bearer <CRON_SECRET>` or `x-cron-secret`. Each route also re-checks the secret in its handler.

- `/api/internal/*` (allocation digest, daily close, portfolio snapshots, x-digest refresh)
- `POST /api/news/ingest`

Vercel crons and local digest scripts can continue to use `CRON_SECRET` only — they do not need the LAN API key.

## Related docs

- [Mobile access and digest](mobile-access-and-digest.md) — Tailscale, SMS digest, `PUBLIC_APP_URL`
- [Desktop](DESKTOP.md) — Electron port 3049, Schwab redirect URI
- [Storage architecture](architecture/storage.md) — SQLite and secrets paths
