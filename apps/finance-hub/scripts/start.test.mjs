import assert from "node:assert/strict";
import http from "node:http";
import { describe, it } from "node:test";

import { loopbackHealthOk } from "./loopbackHealth.mjs";

function listen(handler) {
  const server = http.createServer(handler);
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve({ server, port: typeof addr === "object" && addr ? addr.port : 0 });
    });
  });
}

describe("loopbackHealthOk", () => {
  it("is true only when /api/health returns 200", async () => {
    const { server, port } = await listen((req, res) => {
      if (req.url === "/api/health") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end('{"ok":true}');
        return;
      }
      res.writeHead(404);
      res.end();
    });
    try {
      assert.equal(await loopbackHealthOk(port, 2000), true);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
  });

  it("is false for a non-200 health response or a closed port", async () => {
    const { server, port } = await listen((_req, res) => {
      res.writeHead(503);
      res.end("nope");
    });
    try {
      assert.equal(await loopbackHealthOk(port, 2000), false);
    } finally {
      await new Promise((resolve) => server.close(resolve));
    }
    assert.equal(await loopbackHealthOk(1, 300), false);
  });
});
