#!/usr/bin/env node
/**
 * Read-only Finance Hub stub (CLI + optional --mcp JSON-RPC).
 * Allowlisted GET /api/* only. No sync, no orders.
 */
import { stdin as input, stdout as output } from "node:process";

const BASE = (process.env.FINANCE_HUB_BASE ?? "https://127.0.0.1:3000").replace(/\/+$/, "");
const KEY = process.env.FINANCE_HUB_API_KEY?.trim() ?? "";

const ALLOW = new Set([
  "/api/option-risk",
  "/api/option-situations",
  "/api/strategy-trades",
  "/api/alerts/events",
  "/api/alerts/rules",
  "/api/positions",
  "/api/exposure",
  "/api/allocation",
  "/api/reports",
  "/api/quotes",
  "/api/performance",
  "/api/accounts",
  "/api/health",
]);

function assertAllowed(method, pathWithQuery) {
  const methodU = String(method || "GET").toUpperCase();
  if (methodU !== "GET") throw new Error(`Chinese wall: only GET is allowed (got ${methodU})`);
  const path = String(pathWithQuery || "").split("?")[0];
  if (!ALLOW.has(path)) throw new Error(`Chinese wall: path not on read allowlist: ${path}`);
}

async function hubGet(pathWithQuery) {
  assertAllowed("GET", pathWithQuery);
  const headers = { Accept: "application/json" };
  if (KEY) headers.Authorization = `Bearer ${KEY}`;
  const resp = await fetch(`${BASE}${pathWithQuery}`, { headers });
  const text = await resp.text();
  let json;
  try {
    json = JSON.parse(text);
  } catch {
    json = { raw: text };
  }
  if (!resp.ok) throw new Error(`Hub ${resp.status}: ${text.slice(0, 400)}`);
  return json;
}

async function cli() {
  const method = process.argv[2] ?? "GET";
  const path = process.argv[3] ?? "/api/health";
  const json = await hubGet(path.startsWith("/") ? path : `/${path}`);
  if (method.toUpperCase() !== "GET") throw new Error("CLI only supports GET");
  console.log(JSON.stringify(json, null, 2));
}

function mcpOk(id, result) {
  return { jsonrpc: "2.0", id, result };
}

function mcpErr(id, message) {
  return { jsonrpc: "2.0", id, error: { code: -32000, message } };
}

async function mcpLoop() {
  let buf = "";
  input.setEncoding("utf8");
  input.on("data", async (chunk) => {
    buf += chunk;
    let idx;
    while ((idx = buf.indexOf("\n")) >= 0) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (!line) continue;
      let msg;
      try {
        msg = JSON.parse(line);
      } catch {
        continue;
      }
      const id = msg.id ?? null;
      try {
        if (msg.method === "initialize") {
          output.write(
            `${JSON.stringify(
              mcpOk(id, {
                protocolVersion: "2024-11-05",
                capabilities: { tools: {} },
                serverInfo: { name: "finance-hub-readonly", version: "0.1.0" },
              }),
            )}\n`,
          );
          continue;
        }
        if (msg.method === "tools/list") {
          output.write(
            `${JSON.stringify(
              mcpOk(id, {
                tools: [
                  {
                    name: "hub_get",
                    description: "GET an allowlisted Finance Hub analytics route. No orders.",
                    inputSchema: {
                      type: "object",
                      properties: { path: { type: "string", description: "e.g. /api/option-risk" } },
                      required: ["path"],
                    },
                  },
                ],
              }),
            )}\n`,
          );
          continue;
        }
        if (msg.method === "tools/call" && msg.params?.name === "hub_get") {
          const path = msg.params.arguments?.path;
          const json = await hubGet(path);
          output.write(
            `${JSON.stringify(mcpOk(id, { content: [{ type: "text", text: JSON.stringify(json) }] }))}\n`,
          );
          continue;
        }
        output.write(`${JSON.stringify(mcpOk(id, {}))}\n`);
      } catch (e) {
        output.write(`${JSON.stringify(mcpErr(id, e instanceof Error ? e.message : String(e)))}\n`);
      }
    }
  });
}

if (process.argv.includes("--mcp")) mcpLoop();
else cli().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
