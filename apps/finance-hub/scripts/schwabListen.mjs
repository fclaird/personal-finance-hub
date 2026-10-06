import fs from "node:fs";
import path from "node:path";

const LOOPBACK = new Set(["127.0.0.1", "localhost", "::1"]);

export function certFiles(root, env) {
  const configured = env.FINANCE_HUB_CERT_DIR?.trim();
  const dir = configured ? path.resolve(configured) : path.join(root, "certificates");
  return {
    dir,
    keyPath: path.join(dir, "localhost-key.pem"),
    certPath: path.join(dir, "localhost.pem"),
  };
}

export function certsPresent(files) {
  return fs.existsSync(files.keyPath) && fs.existsSync(files.certPath);
}

function hostReachable(redirectHost, bindHost) {
  const redirect = redirectHost.toLowerCase();
  const bind = bindHost.toLowerCase();
  if (bind === "0.0.0.0" || bind === "::" || bind === "[::]") return true;
  if (redirect === bind) return true;
  return LOOPBACK.has(redirect) && LOOPBACK.has(bind);
}

function browserHost(bindHost) {
  const bind = bindHost.toLowerCase();
  if (bind === "0.0.0.0" || bind === "::" || bind === "[::]") return "127.0.0.1";
  return bindHost;
}

export function missingCertMessage(redirectUri, keyPath, certPath) {
  return (
    `Refusing to start. SCHWAB_REDIRECT_URI is ${redirectUri}, so Finance Hub will not listen with plain HTTP.\n` +
    `Missing ${certPath} and ${keyPath}.\n` +
    `Run: npm run dev`
  );
}

export function wrongProtocolMessage({ want, httpUp, httpsUp, port, redirectUri }) {
  if (want === "https" && httpUp && !httpsUp) {
    return (
      `Refusing to start. 127.0.0.1:${port} is already speaking plain HTTP, but SCHWAB_REDIRECT_URI is ${redirectUri}.\n` +
      `Stop that process, then run: npm start`
    );
  }
  if (want === "http" && httpsUp && !httpUp) {
    return (
      `Refusing to start. 127.0.0.1:${port} is already speaking HTTPS, but SCHWAB_REDIRECT_URI is ${redirectUri}.\n` +
      `Stop that process, then run: npm start`
    );
  }
  return null;
}

export function devNextArgs({ protocol, bindHost, port }) {
  const args = ["node_modules/next/dist/bin/next", "dev", "--hostname", bindHost, "--port", String(port)];
  if (protocol === "https") args.splice(2, 0, "--experimental-https");
  return args;
}

/**
 * @param {{ redirectUri?: string, port: number, bindHost: string, mode: "start" | "dev", certsPresent: boolean }} input
 */
export function resolveListen({ redirectUri, port, bindHost, mode, certsPresent: hasCerts }) {
  const command = mode === "dev" ? "npm run dev" : "npm start";
  const raw = typeof redirectUri === "string" ? redirectUri.trim() : "";
  if (!raw) {
    const protocol = mode === "dev" ? "https" : "http";
    return {
      ok: true,
      protocol,
      origin: `${protocol}://${browserHost(bindHost)}:${port}`,
      port,
      bindHost,
      needsCerts: false,
    };
  }

  let url;
  try {
    url = new URL(raw);
  } catch {
    url = null;
  }
  if (!url || (url.protocol !== "http:" && url.protocol !== "https:")) {
    return {
      ok: false,
      message: `Refusing to start. SCHWAB_REDIRECT_URI is not an http(s) URL: ${raw}\nRun: ${command}`,
    };
  }

  const protocol = url.protocol === "https:" ? "https" : "http";
  const redirectPort = url.port ? Number(url.port) : protocol === "https" ? 443 : 80;
  if (redirectPort !== port) {
    return {
      ok: false,
      message:
        `Refusing to start. SCHWAB_REDIRECT_URI is ${raw} (port ${redirectPort}) but PORT is ${port}.\n` +
        `Run: PORT=${redirectPort} ${command}`,
    };
  }
  if (!hostReachable(url.hostname, bindHost)) {
    return {
      ok: false,
      message:
        `Refusing to start. SCHWAB_REDIRECT_URI host is ${url.hostname} but Finance Hub would bind ${bindHost}.\n` +
        `Run: FINANCE_HUB_BIND_HOST=${url.hostname} ${command}`,
    };
  }

  return {
    ok: true,
    protocol,
    origin: url.origin,
    port,
    bindHost,
    needsCerts: protocol === "https" && mode === "start" && !hasCerts,
  };
}
