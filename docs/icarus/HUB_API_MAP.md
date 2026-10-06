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
| `/api/real-estate` | Owned-property values, loan, equity, and the Main-flavor net-worth strip |

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
| `POST /api/real-estate/valuations` | Save one reading, or a month of readings for both properties |
| `POST /api/real-estate/loans` | Save Crownsville loan terms (local only; incomplete loans are not amortized) |
| `POST /api/real-estate/loan-balances` | Save a mortgage statement balance |
| `POST /api/real-estate/refresh` | Download the FHFA house-price index and rebuild official values |

`POST /api/real-estate/valuations` accepts one reading or a batch. Auth matches other hub routes: open on localhost, or `Authorization: Bearer <FINANCE_HUB_API_KEY>` / `x-finance-hub-key` when that key is set. No flavor cookie is required (the route defaults to Main). A `fh_flavor` cookie of `rorie` or `peyton` returns 404. These POSTs are local SQLite writes. They are not on the read-only MCP allowlist.

```json
{
  "readings": [
    {
      "propertyId": "re_cortland",
      "asOf": "2026-10-06",
      "valueUsd": 250000,
      "lowUsd": 240000,
      "highUsd": 265000,
      "source": "manual_avm",
      "sourceDetail": "zillow",
      "sourceUrl": "https://www.zillow.com/homedetails/..."
    },
    {
      "propertyId": "re_cortland",
      "asOf": "2026-10-06",
      "valueUsd": 255000,
      "source": "manual_avm",
      "sourceDetail": "redfin",
      "sourceUrl": "https://www.redfin.com/..."
    },
    {
      "propertyId": "re_crownsville",
      "asOf": "2026-10-06",
      "valueUsd": 900000,
      "source": "manual_avm",
      "sourceDetail": "realtor",
      "sourceUrl": "https://www.realtor.com/..."
    }
  ]
}
```

`source` is `manual_avm`, `appraisal`, `assessor`, or `purchase`. A public estimate needs `sourceDetail` (`zillow`, `redfin`, `realtor`, or another named source). `lowUsd` and `highUsd` are optional. The same property, date, source, and source detail updates the existing row. `purchase` and `assessor` are reference points and do not set the official value. An appraisal does, once it is newer than the latest month that has two different estimate sources. County figures stay reference-only.

Official value for a month is the median of the distinct estimate sources in that month (the average when there are two). Months with fewer than two sources step from the last official value by the FHFA all-transactions index for Youngstown–Warren (place `49660`) or Baltimore–Columbia–Towson (place `12580`). Cortland is 3131 McCleary Jacoby Rd plus the side lot at 3210; 3141 is only the mailing address.

`POST /api/real-estate/loans` body: `{ "propertyId": "re_crownsville", "interestRate": 6.5, "startDate": "2024-06-21", "monthlyPayment": 4200 }`. Rate may be a decimal (`0.065`) or a percent (`6.5`). Amortization starts only when rate, start date, and a payment (or principal and term) are all present.

## Auth / OAuth (browser only)

`/api/schwab/start`, `/api/schwab/callback`, `/api/x/oauth/*` — connect accounts. Not for agents to “trade.”

## Broker trade / orders

**None.** Schwab Trader `/orders` and `/previewOrder` are blocked in `schwabFetch` unless `FINANCE_HUB_ALLOW_BROKER_ORDERS=1` (must stay unset).

## MCP stub

`apps/finance-hub/mcp/readonly-hub.mjs` — allowlisted GET proxy. See `docs/icarus/READONLY_MCP.md`.
