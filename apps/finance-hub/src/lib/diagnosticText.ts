/** Shared cap for log lines and stored Schwab failure text. */
export const DIAGNOSTIC_TEXT_MAX = 400;

const SECRET_ASSIGNMENT =
  /((?:access_token|refresh_token|id_token|client_secret|accessToken|refreshToken|clientSecret)"?\s*[:=]\s*"?)[^"&\s]*/gi;

/** Drop token-like values. Leaves error codes such as refresh_token_authentication_error intact. */
export function redactDiagnosticSecrets(text: string): string {
  return text
    .replace(SECRET_ASSIGNMENT, "$1[redacted]")
    .replace(/\b(Authorization\s*[:=]\s*)(?:Bearer\s+|Basic\s+)?\S+/gi, "$1[redacted]")
    .replace(/\b(Bearer|Basic)\s+\S+/gi, "$1 [redacted]");
}

/**
 * One short line: collapse whitespace, redact secrets, then keep the start of the text.
 * Callers that need HTTP status must put it at the front before calling this.
 */
export function capDiagnosticText(text: string, max = DIAGNOSTIC_TEXT_MAX): string {
  const bounded = text.length > 16_000 ? text.slice(0, 16_000) : text;
  const flat = redactDiagnosticSecrets(bounded.replace(/\s+/g, " ").trim());
  if (flat.length <= max) return flat;
  if (max <= 3) return flat.slice(0, max);
  return `${flat.slice(0, max - 3)}...`;
}
