#!/usr/bin/env node
import { resolveFinanceHubNode } from "./resolveNode.mjs";

try {
  process.stdout.write(`${resolveFinanceHubNode()}\n`);
} catch (err) {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
}
