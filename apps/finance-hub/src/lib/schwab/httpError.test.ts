import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { DIAGNOSTIC_TEXT_MAX } from "@/lib/diagnosticText";
import { isSchwabRefreshTokenRejectedMessage } from "@/lib/schwab/oauth";

import { schwabHttpError } from "./httpError";

describe("schwabHttpError", () => {
  it("keeps HTTP status and a short snippet, not the response body", () => {
    const body = `<!DOCTYPE html><html><body>${"E".repeat(80_000)}</body></html>`;
    const msg = schwabHttpError(
      "Schwab API error",
      503,
      "Service Unavailable",
      body,
      "https://api.schwabapi.com/trader/v1/accounts",
    );
    assert.ok(msg.startsWith("Schwab API error 503 Service Unavailable"));
    assert.ok(msg.includes("api.schwabapi.com"));
    assert.ok(msg.length <= DIAGNOSTIC_TEXT_MAX);
    assert.equal(msg.includes("E".repeat(500)), false);
  });

  it("drops token values and still matches a rejected refresh token", () => {
    const msg = schwabHttpError(
      "Schwab token refresh failed",
      400,
      "Bad Request",
      '{"error":"refresh_token_authentication_error","refresh_token":"refresh-secret-value","error_description":"Failed refresh token authentication"}',
    );
    assert.ok(msg.startsWith("Schwab token refresh failed 400 Bad Request"));
    assert.equal(msg.includes("refresh-secret-value"), false);
    assert.equal(isSchwabRefreshTokenRejectedMessage(msg), true);
    assert.ok(msg.length <= DIAGNOSTIC_TEXT_MAX);
  });
});
