import assert from "node:assert/strict";
import { afterEach, describe, it } from "node:test";

import {
  apiAuthRequired,
  authorizeApiRequest,
  isApiAuthExemptPath,
  isCronProtectedApiPath,
} from "./apiAuth";

const ENV_KEYS = ["FINANCE_HUB_API_KEY", "CRON_SECRET"] as const;

function saveEnv(): Record<string, string | undefined> {
  const saved: Record<string, string | undefined> = {};
  for (const key of ENV_KEYS) saved[key] = process.env[key];
  return saved;
}

function restoreEnv(saved: Record<string, string | undefined>) {
  for (const key of ENV_KEYS) {
    const v = saved[key];
    if (v === undefined) delete process.env[key];
    else process.env[key] = v;
  }
}

function req(url: string, headers: Record<string, string> = {}): Request {
  return new Request(url, { headers });
}

describe("apiAuth", () => {
  afterEach(() => {
    /* each test restores its own snapshot */
  });

  it("isApiAuthExemptPath allows OAuth callbacks and auth config", () => {
    assert.equal(isApiAuthExemptPath("/api/schwab/callback"), true);
    assert.equal(isApiAuthExemptPath("/api/x/oauth/callback"), true);
    assert.equal(isApiAuthExemptPath("/api/auth/config"), true);
    assert.equal(isApiAuthExemptPath("/api/positions"), false);
  });

  it("isCronProtectedApiPath covers internal routes and news ingest", () => {
    assert.equal(isCronProtectedApiPath("/api/internal/allocation-daily-close"), true);
    assert.equal(isCronProtectedApiPath("/api/news/ingest"), true);
    assert.equal(isCronProtectedApiPath("/api/terminal/x-digest/refresh"), false);
  });

  it("authorizeApiRequest is open when FINANCE_HUB_API_KEY is unset", () => {
    const saved = saveEnv();
    delete process.env.FINANCE_HUB_API_KEY;
    try {
      assert.equal(apiAuthRequired(), false);
      assert.equal(authorizeApiRequest(req("http://localhost/api/positions")), true);
    } finally {
      restoreEnv(saved);
    }
  });

  it("authorizeApiRequest requires API key on protected routes when configured", () => {
    const saved = saveEnv();
    process.env.FINANCE_HUB_API_KEY = "lan-key";
    try {
      assert.equal(authorizeApiRequest(req("http://localhost/api/positions")), false);
      assert.equal(
        authorizeApiRequest(req("http://localhost/api/positions", { authorization: "Bearer lan-key" })),
        true,
      );
      assert.equal(
        authorizeApiRequest(req("http://localhost/api/positions", { "x-finance-hub-key": "lan-key" })),
        true,
      );
    } finally {
      restoreEnv(saved);
    }
  });

  it("authorizeApiRequest accepts CRON_SECRET on cron routes when LAN auth is on", () => {
    const saved = saveEnv();
    process.env.FINANCE_HUB_API_KEY = "lan-key";
    process.env.CRON_SECRET = "cron-key";
    try {
      assert.equal(authorizeApiRequest(req("http://localhost/api/internal/allocation-daily-close")), false);
      assert.equal(
        authorizeApiRequest(
          req("http://localhost/api/internal/allocation-daily-close", { authorization: "Bearer cron-key" }),
        ),
        true,
      );
      assert.equal(
        authorizeApiRequest(
          req("http://localhost/api/news/ingest", { "x-cron-secret": "cron-key" }),
        ),
        true,
      );
      assert.equal(
        authorizeApiRequest(
          req("http://localhost/api/internal/allocation-daily-close", { authorization: "Bearer lan-key" }),
        ),
        true,
      );
    } finally {
      restoreEnv(saved);
    }
  });
});
