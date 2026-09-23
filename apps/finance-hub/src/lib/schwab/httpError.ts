import { capDiagnosticText, DIAGNOSTIC_TEXT_MAX } from "@/lib/diagnosticText";

/**
 * Failure text safe to throw, log, and store. Keeps HTTP status and a short body snippet.
 * Does not include Authorization headers or token values.
 */
export function schwabHttpError(
  kind: string,
  status: number,
  statusText: string,
  body: string,
  requestUrl?: string,
): string {
  const statusLabel = `${status}${statusText ? ` ${statusText}` : ""}`.trim();
  const loc = requestUrl ? ` (${requestUrl})` : "";
  const snippet = body.replace(/\s+/g, " ").trim();
  const raw = snippet ? `${kind} ${statusLabel}${loc} ${snippet}` : `${kind} ${statusLabel}${loc}`;
  return capDiagnosticText(raw, DIAGNOSTIC_TEXT_MAX);
}
