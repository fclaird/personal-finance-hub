import http from "node:http";
import https from "node:https";

export async function loopbackHealthOk(port, timeoutMs = 5000, protocol = "http") {
  const report = await readLoopbackHealth(port, timeoutMs, protocol);
  return report != null;
}

/** Parsed /api/health body, or null when the probe times out or is not 200. */
export async function readLoopbackHealth(port, timeoutMs = 5000, protocol = "http") {
  if (protocol === "https") return readProbe(https, port, timeoutMs, { rejectUnauthorized: false });
  return readProbe(http, port, timeoutMs, {});
}

function readProbe(mod, port, timeoutMs, extra) {
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
        const chunks = [];
        res.on("data", (chunk) => chunks.push(chunk));
        res.on("end", () => {
          if (res.statusCode !== 200) {
            resolve(null);
            return;
          }
          try {
            resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
          } catch {
            resolve(null);
          }
        });
      },
    );
    req.on("error", () => resolve(null));
    req.on("timeout", () => {
      req.destroy();
      resolve(null);
    });
  });
}
