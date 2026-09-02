import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import { loadEnvLocal } from "./loadEnvLocal.mjs";

describe("loadEnvLocal", () => {
  it("fills missing keys from .env.local and does not override", () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fh-env-"));
    fs.writeFileSync(
      path.join(dir, ".env.local"),
      'FINANCE_HUB_API_KEY="from-file"\nFINANCE_HUB_BIND_HOST=0.0.0.0\n# comment\n',
    );
    const prevKey = process.env.FINANCE_HUB_API_KEY;
    const prevHost = process.env.FINANCE_HUB_BIND_HOST;
    delete process.env.FINANCE_HUB_BIND_HOST;
    process.env.FINANCE_HUB_API_KEY = "already-set";
    try {
      loadEnvLocal(dir);
      assert.equal(process.env.FINANCE_HUB_API_KEY, "already-set");
      assert.equal(process.env.FINANCE_HUB_BIND_HOST, "0.0.0.0");
    } finally {
      if (prevKey === undefined) delete process.env.FINANCE_HUB_API_KEY;
      else process.env.FINANCE_HUB_API_KEY = prevKey;
      if (prevHost === undefined) delete process.env.FINANCE_HUB_BIND_HOST;
      else process.env.FINANCE_HUB_BIND_HOST = prevHost;
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });
});
