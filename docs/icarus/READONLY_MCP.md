# Read-only Hub MCP / CLI stub

Agents should treat Finance Hub as a **read** surface. This stub wraps localhost `/api/*` GETs with an allowlist and optional `FINANCE_HUB_API_KEY`.

## Contract

```
FINANCE_HUB_BASE   default https://127.0.0.1:3000
FINANCE_HUB_API_KEY  sent as Authorization: Bearer … when set
```

Allowed paths (GET only):

- `/api/option-risk`
- `/api/option-situations`
- `/api/strategy-realized`
- `/api/strategy-trades`
- `/api/alerts/events`
- `/api/alerts/rules`
- `/api/positions`
- `/api/exposure`
- `/api/allocation`
- `/api/reports`
- `/api/quotes`
- `/api/performance`
- `/api/accounts`
- `/api/health`

Rejected: any non-GET, any path not on the list (including Schwab sync and anything that could grow into orders).

## CLI

From `apps/finance-hub`:

```bash
node mcp/readonly-hub.mjs GET /api/option-risk
node mcp/readonly-hub.mjs GET /api/option-situations
```

JSON-RPC MCP `tools/list` + `tools/call` (`hub_get`) is also accepted on stdin when run with `--mcp`.

This is a **scaffold**, not a published MCP package. Do not add trade tools.
