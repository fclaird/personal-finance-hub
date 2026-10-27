import fs from "node:fs";
import path from "node:path";

import { copySchemaBesideStandaloneServers, copySqliteNativeIntoStandalone } from "./sqliteStandalone.mjs";

/**
 * `next start` warns and is unsupported when output is "standalone".
 * The production server is `.next/standalone/server.js`. Next does not copy
 * `.next/static` or `public` into that folder; do it before listen.
 * @see https://nextjs.org/docs/app/api-reference/config/next-config-js/output
 */
export function prepareStandaloneAssets(root) {
  const standaloneDir = path.join(root, ".next", "standalone");
  const serverJs = path.join(standaloneDir, "server.js");
  if (!fs.existsSync(serverJs)) {
    throw new Error(
      `Missing ${serverJs}. Build first (scripts/launch-financial-bridge.sh, or npm run build).`,
    );
  }

  const staticSrc = path.join(root, ".next", "static");
  const staticDest = path.join(standaloneDir, ".next", "static");
  if (fs.existsSync(staticSrc)) {
    fs.rmSync(staticDest, { recursive: true, force: true });
    fs.mkdirSync(path.dirname(staticDest), { recursive: true });
    fs.cpSync(staticSrc, staticDest, { recursive: true, dereference: true });
  }

  const publicSrc = path.join(root, "public");
  const publicDest = path.join(standaloneDir, "public");
  if (fs.existsSync(publicSrc)) {
    fs.rmSync(publicDest, { recursive: true, force: true });
    fs.cpSync(publicSrc, publicDest, { recursive: true, dereference: true });
  }

  const nativeFiles = copySqliteNativeIntoStandalone(root);
  const schemaFiles = copySchemaBesideStandaloneServers(root);
  return { standaloneDir, serverJs, nativeFiles, schemaFiles };
}
