import http from "node:http";
import https from "node:https";

/**
 * True when /api/health on loopback returns 200 for the protocol this process would serve.
 */
export async function loopbackHealthOk(port, timeoutMs = 5000, protocol = "http") {
  if (protocol === "https") return probe(https, port, timeoutMs, { rejectUnauthorized: false });
  return probe(http, port, timeoutMs, {});
}

function probe(mod, port, timeoutMs, extra) {
  return new Promise((resolve) => {
    const req = mod.get(
      {
        hostname: "127.0.0.1",
        port,
        path: "/api/health",
        timeout: timeoutMs,
        ...extra,
      },
      (res) => {
        res.resume();
        resolve(res.statusCode === 200);
      },
    );
    req.on("error", () => resolve(false));
    req.on("timeout", () => {
      req.destroy();
      resolve(false);
    });
  });
}
