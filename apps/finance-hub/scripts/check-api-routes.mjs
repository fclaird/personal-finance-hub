#!/usr/bin/env node
/** Assert API route count matches expected (drift detection). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const expected = Number(process.env.FINANCE_HUB_EXPECTED_API_ROUTES ?? "88");
const appRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const apiRoot = path.join(appRoot, "src", "app", "api");

function countRoutes(dir) {
  let n = 0;
  for (const ent of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, ent.name);
    if (ent.isDirectory()) n += countRoutes(full);
    else if (ent.name === "route.ts") n += 1;
  }
  return n;
}

const found = countRoutes(apiRoot);
if (found !== expected) {
  console.error(`Expected ${expected} API routes under src/app/api, found ${found}`);
  process.exit(1);
}
console.log(`OK: ${found} API routes`);
