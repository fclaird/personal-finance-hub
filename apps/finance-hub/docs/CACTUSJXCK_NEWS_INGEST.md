# CaktusJxck news ingest (iOS Shortcut)

Finance Hub can show posts from the [CaktusJxck](https://whatsapp.com/channel/0029Vb7dftiFSAt08zppgA3e) WhatsApp channel on **Terminal → Market news** and on each **symbol page → News**. WhatsApp does not expose a public RSS feed for channels, so ingestion uses a one-tap **Share → Shortcut** that POSTs the message text to your local app.

## Prerequisites

1. **Schwab sync** is optional for the feed itself, but symbol tags work best when holdings are synced (tickers are matched against your portfolio).
2. Set **`CRON_SECRET`** in `.env.local` (same secret used for other internal cron routes).
3. Run the app with **`npm run dev`** (recommended for correct SQLite on Apple Silicon).

**Important:** `npm run dev` starts Next with **`--experimental-https`**. Use **`https://`** (not `http://`) on port 3000. Plain HTTP to that port returns `curl: (1) Received HTTP/0.9 when not allowed`.

## Reachability from your iPhone

The Shortcut must reach your Mac (or server) running finance-hub:

| Setup | URL example |
|--------|-------------|
| Same Wi‑Fi (dev) | `https://192.168.x.x:3000/api/news/ingest` |
| Tailscale / VPN (dev) | `https://100.x.x.x:3000/api/news/ingest` |
| Tunnel | `https://your-subdomain.ngrok-free.app/api/news/ingest` |
| Production (`npm run start`) | `http://127.0.0.1:3000/api/news/ingest` (plain HTTP) |

Replace host/port with your machine. For local HTTPS dev, Shortcuts may need to allow insecure/local certs or use a tunnel that terminates HTTPS for you.

## API

**POST** `/api/news/ingest`

**Headers**

- `Authorization: Bearer <CRON_SECRET>`
- `Content-Type: application/json`

**Single post**

```json
{
  "text": "Full message copied from WhatsApp",
  "link": "https://optional-article-url.com",
  "publishedAt": "2026-05-19T14:30:00Z"
}
```

`link` and `publishedAt` are optional. If `link` is omitted, the first `https://` URL in `text` is used; otherwise a stable in-app id is stored.

**Batch**

```json
{
  "items": [
    { "text": "First post…" },
    { "text": "Second post…" }
  ]
}
```

**Response**

```json
{ "ok": true, "inserted": 1, "skipped": 0, "received": 1 }
```

Duplicates (same normalized text) are skipped via content hash.

## Test from Terminal (Mac)

```bash
# Load secret from .env.local (dev uses HTTPS)
export CRON_SECRET="$(grep '^CRON_SECRET=' .env.local | cut -d= -f2-)"
curl -sS -k -X POST "https://127.0.0.1:3000/api/news/ingest" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{"text":"$PLTR wins new contract https://example.com/story"}'
```

Expect: `{"ok":true,"inserted":1,"skipped":0,"received":1}`. If you see `Unauthorized`, `CRON_SECRET` is wrong or still literally `YOUR_CRON_SECRET`.

Then open **Terminal** in the app and confirm the headline appears under **Market news**.

## iOS Shortcut (sketch)

1. Shortcuts → **New Shortcut** → name it e.g. **Send to Finance Hub News**.
2. Set shortcut to accept **Share Sheet** input (text from WhatsApp).
3. Actions (in order):
   - **Receive** input from Share Sheet
   - **Get Text** from Input
   - **Get URLs** from Input (optional; use first URL as `link` in JSON if you build a dictionary)
   - **Get contents of URL** — configure as **POST** to your ingest URL with headers:
     - `Authorization`: `Bearer YOUR_CRON_SECRET`
     - `Content-Type`: `application/json`
   - Body (JSON): `{"text": "<Text from step 2>"}`  
     (Advanced: add `"link"` if you extracted a URL.)
   - **Show Notification** — “Sent to Finance Hub” on success
4. In WhatsApp: open a CaktusJxck post → **Share** → **Send to Finance Hub News**.

### Shortcut tip

For high-volume channels, share only posts you care about, or run a batch curl from Mac when you copy several messages into a file.

## Where it appears in the app

- **Terminal** — section **Market news** (ingested items first, then Yahoo/RSS).
- **Symbol page** — **News** (items tagged with that ticker or matching the headline).

## Retention

Ingested rows are kept about **30 days**, capped at **2000** items, oldest pruned first.

## Troubleshooting

| Issue | Check |
|--------|--------|
| 401 Unauthorized | `CRON_SECRET` matches Bearer token |
| Connection failed on phone | LAN IP, firewall, or tunnel |
| Empty feed after ingest | Refresh Terminal; call `GET /api/terminal/news?sources=ingest` |
| Symbol page empty | Post must mention ticker (`$PLTR`, `PLTR`) or a held symbol |
