import assert from "node:assert/strict";
import test from "node:test";

import { createPositionsBookClient, positionsForAccount } from "@/lib/client/positionsBook";

test("one positions response splits into per-account rows", () => {
  const rows = [
    { accountId: "a", symbol: "NOW" },
    { accountId: "b", symbol: "PLTR" },
    { accountId: "a", symbol: "NVDA" },
    { accountId: "c", symbol: "TSLA" },
    { accountId: "d", symbol: "AMD" },
    { accountId: "e", symbol: "META" },
    { accountId: "f", symbol: "GOOG" },
  ];
  const accounts = ["a", "b", "c", "d", "e", "f"];
  const splits = accounts.map((id) => positionsForAccount(rows, id));
  assert.equal(splits.length, 6);
  assert.deepEqual(
    splits.flat().map((row) => row.symbol),
    ["NOW", "NVDA", "PLTR", "TSLA", "AMD", "META", "GOOG"],
  );
  assert.equal(positionsForAccount(rows, "missing").length, 0);
});

test("concurrent book loads share a single request", async () => {
  let calls = 0;
  let clock = 0;
  let release: () => void = () => undefined;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const fetchImpl = (async (url: string | URL | Request) => {
    calls += 1;
    await gate;
    const refresh = String(url).includes("refresh=1");
    const symbol = refresh ? "PLTR" : "NOW";
    const accountId = refresh ? "ira" : "joint";
    return new Response(JSON.stringify({ ok: true, positions: [{ accountId, symbol }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as typeof fetch;

  const client = createPositionsBookClient(fetchImpl, () => clock);
  const first = client.load();
  const second = client.load();
  assert.equal(calls, 1);
  release();
  const [a, b] = await Promise.all([first, second]);
  assert.equal(a.positions?.[0]?.symbol, "NOW");
  assert.equal(b, a);

  clock += 20_000;
  const refreshed = await client.load({ refresh: true });
  assert.equal(calls, 2);
  assert.equal(refreshed.positions?.[0]?.symbol, "PLTR");
});
