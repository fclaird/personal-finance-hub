/**
 * In-memory OAuth `state` store so Schwab callback succeeds even when the browser
 * hits a different host than `/api/schwab/start` (e.g. `localhost` vs `127.0.0.1`),
 * where the state cookie would not be sent.
 */

const TTL_MS = 12 * 60 * 1000;

declare global {
  var __fhSchwabOAuthStates: Map<string, number> | undefined;
}

function store(): Map<string, number> {
  if (!globalThis.__fhSchwabOAuthStates) globalThis.__fhSchwabOAuthStates = new Map();
  return globalThis.__fhSchwabOAuthStates;
}

function prune() {
  const m = store();
  const now = Date.now();
  for (const [k, t] of m) {
    if (now - t > TTL_MS) m.delete(k);
  }
}

export function rememberSchwabOAuthState(state: string) {
  prune();
  store().set(state, Date.now());
}

/** Remove state if present (e.g. cookie path succeeded). */
export function forgetSchwabOAuthState(state: string) {
  store().delete(state);
}

/** True if state was known and removed (memory-only validation path). */
export function consumeSchwabOAuthState(state: string): boolean {
  prune();
  const m = store();
  if (!m.has(state)) return false;
  m.delete(state);
  return true;
}
