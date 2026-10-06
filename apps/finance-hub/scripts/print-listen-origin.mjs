#!/usr/bin/env node
import path from "node:path";
import { fileURLToPath } from "node:url";

import { loadEnvLocal } from "./loadEnvLocal.mjs";
import { certFiles, certsPresent, missingCertMessage, resolveListen } from "./schwabListen.mjs";

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), "..");
loadEnvLocal(root);

const bindHost = (process.env.FINANCE_HUB_BIND_HOST ?? "127.0.0.1").trim() || "127.0.0.1";
const port = Number(process.env.PORT ?? 3000) || 3000;
const files = certFiles(root, process.env);
const redirectUri = process.env.SCHWAB_REDIRECT_URI;
const plan = resolveListen({
  redirectUri,
  port,
  bindHost,
  mode: "start",
  certsPresent: certsPresent(files),
});

if (!plan.ok) {
  console.error(plan.message);
  process.exit(1);
}
if (plan.needsCerts) {
  console.error(missingCertMessage(redirectUri?.trim() || plan.origin, files.keyPath, files.certPath));
  process.exit(1);
}

process.stdout.write(`${plan.origin}\n`);
