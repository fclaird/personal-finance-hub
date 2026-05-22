# Mobile access and allocation digests

This doc covers **Path A** (reach your local hub from a phone) and **Path B** (scheduled allocation summaries). It includes a short **threat model** so you can choose between VPN-only access and a public tunnel.

## Threat model (choose-access-model)

| Approach | Exposure | Best for |
|----------|----------|----------|
| **Tailscale only** (no Funnel) | Mac is reachable only on the tailnet; no public URL. | Personal use, lowest blast radius. Phone installs Tailscale, opens `http://<100.x.y.z>:3000`. |
| **Cloudflare Tunnel + Access** | HTTPS is public, but Access (or similar) gates who can hit the origin. | You need a shareable URL without installing Tailscale on every device. |
| **ngrok / raw tunnel** | Public URL → your Next server. | Quick tests only unless you add auth in front. |

**Risks:** The hub reads portfolio data from SQLite and may hold Schwab/OAuth tokens on disk. Anyone who can use the app as you can see balances. Treat **CRON_SECRET**, tunnel URLs, and JWT report tokens like passwords.

**OAuth:** Schwab (and others) may only allow specific redirect URIs. If login breaks through a tunnel hostname, use **Tailscale** so the browser still sees a private IP, or register the tunnel hostname in the Schwab developer app.

## Path A: Tunnel setup (tunnel-setup)

### Tailscale (recommended)

1. Install [Tailscale](https://tailscale.com/download) on the Mac and phone; log in to the same tailnet.
2. On the Mac, run the hub: `npm run dev` or `npm run start` (default port **3000**; dev uses HTTPS experimental—use the URL Next prints).
3. Find the Mac’s Tailscale IP: `tailscale ip -4`.
4. On the phone’s browser: `https://<tailscale-ip>:3000` **or** `http://...` if you use plain HTTP for `next start`.

If `next dev --experimental-https` uses a self-signed cert, the phone may warn—trust for development or use `next start` behind a reverse proxy.

**Checklist (tunnel-tailscale):**

- [ ] Tailscale installed and signed in on **Mac** and **phone** (same tailnet).
- [ ] Hub running on the Mac on port **3000** (`npm run start` recommended for predictable HTTP, or `npm run dev` if you accept cert prompts).
- [ ] Phone loads the hub at `http://<tailscale-ip>:3000` (or your HTTPS URL).
- [ ] Set `PUBLIC_APP_URL` in `.env.local` to a base URL the **phone can open** (Tailscale IP/hostname with scheme, or your tunnel URL) so digest SMS links work on cellular.

### Cloudflare Tunnel (quick reference)

1. Install `cloudflared`, authenticate, create a tunnel to `http://127.0.0.1:3000`.
2. Add **Cloudflare Access** or HTTP basic auth in front of the tunnel hostname.
3. Document the public hostname in your Schwab app if you need OAuth through it.

### Environment variables (digests / cron)

| Variable | Purpose |
|----------|---------|
| `CRON_SECRET` | Bearer secret for `/api/internal/*` routes (same pattern as X digest refresh). |
| `PUBLIC_APP_URL` | Optional base URL (no trailing slash) for links in SMS/email, e.g. `https://your-tunnel.example.com`. |
| `TWILIO_ACCOUNT_SID`, `TWILIO_AUTH_TOKEN`, `TWILIO_FROM_NUMBER` | SMS delivery. |
| `DIGEST_SMS_TO` | E.164 destination for SMS, e.g. `+15551234567`. |
| `RESEND_API_KEY`, `DIGEST_EMAIL_FROM`, `DIGEST_EMAIL_TO` | Optional email with full numbers (Resend HTTP API). |
| `ALLOC_REPORT_SECRET` | Optional; if set, used to sign report JWTs instead of `CRON_SECRET`. |

**SMS policy:** Automated SMS bodies are **percentages only**—no dollar amounts (see `formatAllocationDigestSms` in code).

## Path B: Allocation digest API

- **GET** `/api/internal/allocation-digest` — JSON snapshot (consolidated + per-account), weights and totals. Auth: `Authorization: Bearer <CRON_SECRET>` or `?secret=` (same as X digest).
- **GET** `/api/internal/allocation-digest?format=jwt` — returns `{ ok, token, expiresInSec }` for opening `/allocation/report?token=...` or PDF scripts.
- **POST** `/api/internal/allocation-digest/notify` — sends SMS (% only) and optional Resend email (full detail). Same auth.

### Manual smoke test

```bash
export CRON_SECRET=your-secret
curl -sS -H "Authorization: Bearer $CRON_SECRET" "http://127.0.0.1:3000/api/internal/allocation-digest" | jq .
```

### Scheduled run (launchd example)

Run weekly Sunday 08:00 (adjust paths and secret):

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key>
  <string>com.financehub.allocation-digest</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/bin/curl</string>
    <string>-sS</string>
    <string>-X</string>
    <string>POST</string>
    <string>-H</string>
    <string>Authorization: Bearer YOUR_CRON_SECRET</string>
    <string>http://127.0.0.1:3000/api/internal/allocation-digest/notify</string>
  </array>
  <key>StartCalendarInterval</key>
  <dict>
    <key>Weekday</key>
    <integer>0</integer>
    <key>Hour</key>
    <integer>8</integer>
    <key>Minute</key>
    <integer>0</integer>
  </dict>
</dict>
</plist>
```

Place in `~/Library/LaunchAgents/`, then `launchctl load ~/Library/LaunchAgents/com.financehub.allocation-digest.plist`.

Requires **Next server running** (`npm run start`) or invoke a small local helper that starts the server—adjust to your ops setup.

## PDF export (Playwright)

First install the browser once:

```bash
npx playwright install chromium
```

Then (with `npm run start` in another terminal):

```bash
npm run digest:pdf
```

Set `PUBLIC_APP_URL`, `CRON_SECRET`, and optionally `DIGEST_PDF_PATH` (defaults to `./allocation-report.pdf`). The script mints a short-lived JWT, prints to PDF.

## Related UI

The allocation page and **FinancePiePanel** use responsive heights so charts fit better on ~375px-wide viewports when using a tunnel or narrow browser.
