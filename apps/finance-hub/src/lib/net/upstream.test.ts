import assert from "node:assert/strict";
import http from "node:http";
import type { Socket } from "node:net";
import { describe, it } from "node:test";

import { curlDeadlineArgs, execFileWithTimeout, fetchWithTimeout, UPSTREAM_TIMEOUT_MS } from "./upstream";

function listen(server: http.Server): Promise<number> {
  return new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const addr = server.address();
      resolve(typeof addr === "object" && addr ? addr.port : 0);
    });
  });
}

describe("upstream deadlines", () => {
  it("puts a max-time on curl", () => {
    const args = curlDeadlineArgs();
    assert.ok(args.includes("--max-time"));
    assert.equal(args[args.indexOf("--max-time") + 1], String(UPSTREAM_TIMEOUT_MS / 1000));
  });

  it("kills a child that ignores the deadline", async () => {
    const started = Date.now();
    await assert.rejects(
      execFileWithTimeout("sleep", ["30"], { timeoutMs: 200 }),
      (err: NodeJS.ErrnoException & { killed?: boolean }) => err.killed === true,
    );
    assert.ok(Date.now() - started < 3_000);
  });

  it("drops sockets after many upstreams accept and never answer", async () => {
    const sockets = new Set<Socket>();
    const server = http.createServer((req) => {
      req.resume();
    });
    server.on("connection", (socket) => {
      sockets.add(socket);
      socket.on("close", () => sockets.delete(socket));
    });
    const port = await listen(server);
    try {
      const url = `http://127.0.0.1:${port}/api/positions`;
      const results = await Promise.allSettled(
        Array.from({ length: 30 }, () => fetchWithTimeout(url, {}, 80)),
      );
      assert.equal(
        results.every((result) => result.status === "rejected"),
        true,
      );
      const deadline = Date.now() + 1_500;
      while (sockets.size > 4 && Date.now() < deadline) {
        await new Promise((resolve) => setTimeout(resolve, 20));
      }
      assert.ok(sockets.size < 5, `expected stalled sockets to close, still open: ${sockets.size}`);
    } finally {
      for (const socket of sockets) socket.destroy();
      await new Promise((resolve) => server.close(resolve));
    }
  });
});
