# View Finance Hub from another desktop over VPN

Read/analytics only. **Do not** enable `FINANCE_HUB_ALLOW_BROKER_ORDERS`. The Chinese wall still applies: this path is for watching the book, not trading.

**Recommended path:** run the **Next server** on the Mac that holds SQLite/tokens, then open it from the other machine over **Tailscale** (or WireGuard / a home VPN). **Electron is local-only** — do not use the desktop app as the remote listener.

## Which process to run

| Process | Bind | Use for remote view? |
|---------|------|----------------------|
| `npm run start` (after `npm run build`) | `127.0.0.1` unless `FINANCE_HUB_BIND_HOST` is set | **Yes** — HTTP, predictable. Preferred. |
| `npm run dev` | `127.0.0.1` + experimental HTTPS | Possible; self-signed cert warnings on the remote browser. |
| `npm run desktop:dev` / packaged Electron | always `127.0.0.1:3049` | **No** — window on the Mac only. |

Secrets and the DB stay on the host: `~/.local/share/finance-hub/`. The remote browser is just a client.

## Setup (Tailscale — recommended)

1. Install [Tailscale](https://tailscale.com/download) on the **Mac that runs the hub** and on the **desktop you want to view from**. Same tailnet.
2. On the Mac, in `apps/finance-hub/.env.local`:

   ```bash
   FINANCE_HUB_API_KEY="generate-a-long-random-string"
   FINANCE_HUB_BIND_HOST="0.0.0.0"
   PORT=3000
   # Optional: tighter bind to the tailnet address only
   # FINANCE_HUB_BIND_HOST="$(tailscale ip -4)"
   PUBLIC_APP_URL="http://<mac-tailscale-ip>:3000"
   ```

   Binding anything other than loopback **requires** `FINANCE_HUB_API_KEY`. `npm run start` and `npm run dev` load `.env.local` before the bind check, so these keys do not have to be exported in the shell. The wrappers exit if the bind is remote and the key is missing.

3. Build and listen (from `apps/finance-hub`):

   ```bash
   npm run build
   npm run start
   ```

4. On the Mac: `tailscale ip -4` (e.g. `100.x.y.z`).
5. On the remote desktop browser: `http://100.x.y.z:3000`. Unlock the flavor, then enter the API key when prompted (stored in that tab’s `sessionStorage` only).
6. Keep the Mac’s firewall such that **port 3000 is not open to the public internet**. Tailscale traffic stays on the tailnet.

### WireGuard / home VPN

Same as above: the hub host is a VPN peer; bind `0.0.0.0` or the VPN interface address; open `http://<vpn-ip>:3000` from the other peer. Still set `FINANCE_HUB_API_KEY`. Do not port-forward 3000 on the router.

## HTTPS

`npm run start` is plain HTTP. That is acceptable on a private Tailscale/WireGuard network. For HTTPS:

- Tailscale **MagicDNS** + HTTPS certificates, or
- a reverse proxy on the Mac (Caddy/nginx) terminating TLS to `127.0.0.1:3000` (then you can leave `FINANCE_HUB_BIND_HOST` at loopback).

`npm run dev` uses Next’s experimental HTTPS (self-signed). The remote browser will warn; trust only if you accept that, or use `start` instead.

## Schwab OAuth from the remote browser

Redirect URIs are typically `http://127.0.0.1:3000/api/schwab/callback`. Completing **Connect Schwab** from the remote desktop will fail unless that callback is registered for the VPN hostname. Prefer connecting Schwab **on the Mac** (localhost), then only **view** from the other desktop.

## Do not

- Bind `0.0.0.0` without `FINANCE_HUB_API_KEY`
- Expose the hub on the open internet (ngrok/raw Funnel) without an extra gate
- Set `FINANCE_HUB_ALLOW_BROKER_ORDERS`
- Treat Electron as a remote server

## Related

- [security.md](../../../docs/security.md) — API key, cron, OAuth exemptions
- [mobile-access-and-digest.md](mobile-access-and-digest.md) — phone + digest
- [DESKTOP.md](DESKTOP.md) — Electron localhost shell
