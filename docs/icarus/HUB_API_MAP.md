# Finance Hub — localhost API map (Icarus / agents)

Base: `https://127.0.0.1:3000` (or Electron `3049`). When `FINANCE_HUB_API_KEY` is set, send `Authorization: Bearer <key>` or `x-finance-hub-key`.

**Chinese wall:** agents may use **read/analytics** and **local-only writes**. There are **no** broker order endpoints. Do not add any.

## Read / analytics (MCP-safe GET)

| Route | Purpose |
|---|---|
| `/api/option-risk` | Live undefined-risk / naked / Δ / DTE / assignment / margin |
| `/api/option-situations` | Linked situations + net premium (`?format=csv`) |
| `/api/strategy-realized` | Closed-book realized G/L by strategy + underlying (`?period=all\|ytd\|YYYY&format=csv`) |
| `/api/strategy-trades` | Classified TRADE ledger (`?category=&format=csv`) |
| `/api/alerts/events` | Persisted alert events |
| `/api/alerts/rules` | Rule list (GET) |
| `/api/positions` | Latest snapshots + option marks |
| `/api/exposure` | Underlying exposure rollup |
| `/api/allocation` | Allocation |
| `/api/reports` | Period P&L / realized |
| `/api/quotes` | Quotes |
| `/api/performance` | Performance |
| `/api/accounts` | Accounts |
| `/api/health` | Liveness |

Other `GET /api/*` pages (terminal, dividends, earnings, taxonomy, …) are also read-only.

## Local writes (SQLite / sync — not broker orders)

These change **local** data or pull **reads** from Schwab. They do **not** place trades.

| Route | Purpose |
|---|---|
| `POST /api/schwab/sync` | Holdings / quotes refresh |
| `POST /api/schwab/transactions/sync` | Pull TRADE history |
| `POST /api/strategy-trades/reclassify` | Re-bucket + rebuild situations |
| `POST /api/option-situations` | Propose / refresh auto-links |
| `PATCH /api/option-situations/:id` | Confirm or reject a link |
| `POST /api/alerts/run` | Evaluate rules → local events |
| `POST /api/alerts/rules` | Enable/disable local rules |

## Auth / OAuth (browser only)

`/api/schwab/start`, `/api/schwab/callback`, `/api/x/oauth/*` — connect accounts. Not for agents to “trade.”

## Broker trade / orders

**None.** Schwab Trader `/orders` and `/previewOrder` are blocked in `schwabFetch` unless `FINANCE_HUB_ALLOW_BROKER_ORDERS=1` (must stay unset).

## MCP stub

`apps/finance-hub/mcp/readonly-hub.mjs` — allowlisted GET proxy. See `docs/icarus/READONLY_MCP.md`.
