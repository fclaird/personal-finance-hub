import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { capDiagnosticText, DIAGNOSTIC_TEXT_MAX, redactDiagnosticSecrets } from "./diagnosticText";

describe("capDiagnosticText", () => {
  it("collapses whitespace and keeps the start of a long body", () => {
    const text = capDiagnosticText(`status 503\n\n${"x".repeat(5_000)}`);
    assert.ok(text.startsWith("status 503"));
    assert.equal(text.length, DIAGNOSTIC_TEXT_MAX);
    assert.ok(text.endsWith("..."));
    assert.equal(text.includes("\n"), false);
  });

  it("redacts tokens without eating Schwab refresh error codes", () => {
    const raw =
      '{"error":"refresh_token_authentication_error","access_token":"super-secret-token","error_description":"Failed refresh token authentication"} Authorization: Bearer abc.def.ghi leftover Bearer bare-token-value';
    const text = redactDiagnosticSecrets(raw);
    assert.match(text, /refresh_token_authentication_error/);
    assert.match(text, /Failed refresh token authentication/);
    assert.equal(text.includes("super-secret-token"), false);
    assert.equal(text.includes("abc.def.ghi"), false);
    assert.equal(text.includes("bare-token-value"), false);
    assert.match(text, /access_token":"\[redacted\]/);
    assert.match(text, /Authorization: \[redacted\]/);
    assert.match(text, /Bearer \[redacted\]/);
  });
});
