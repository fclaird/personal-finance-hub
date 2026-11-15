import { execFile } from "node:child_process";
import { Agent, fetch as undiciFetch } from "undici";

/** Hard cap for one Schwab, Yahoo, Stooq, SEC, or FHFA call. */
export const UPSTREAM_TIMEOUT_MS = 20_000;

/** execFile kill is a little later so curl --max-time can exit on its own. */
export const UPSTREAM_KILL_MS = UPSTREAM_TIMEOUT_MS + 5_000;

export function upstreamSignal(parent?: AbortSignal | null, ms = UPSTREAM_TIMEOUT_MS): AbortSignal {
  const timed = AbortSignal.timeout(ms);
  if (!parent) return timed;
  if (typeof AbortSignal.any === "function") return AbortSignal.any([parent, timed]);
  return timed;
}

export function curlDeadlineArgs(seconds = UPSTREAM_TIMEOUT_MS / 1000): string[] {
  return ["--connect-timeout", "10", "--max-time", String(seconds)];
}

export function execFileWithTimeout(
  command: string,
  args: string[],
  opts?: { maxBuffer?: number; timeoutMs?: number },
): Promise<{ stdout: string }> {
  const timeoutMs = opts?.timeoutMs ?? UPSTREAM_KILL_MS;
  return new Promise((resolve, reject) => {
    execFile(
      command,
      args,
      { maxBuffer: opts?.maxBuffer, timeout: timeoutMs, killSignal: "SIGKILL" },
      (err, stdout) => {
        if (err) reject(err);
        else resolve({ stdout: String(stdout ?? "") });
      },
    );
  });
}

const agents = new Map<number, Agent>();

function agentFor(ms: number): Agent {
  const existing = agents.get(ms);
  if (existing) return existing;
  const agent = new Agent({
    headersTimeout: ms,
    bodyTimeout: ms,
    connectTimeout: Math.min(10_000, ms),
    keepAliveTimeout: 1_000,
  });
  agents.set(ms, agent);
  return agent;
}

/**
 * AbortSignal.timeout rejects the promise and leaves the TCP socket open.
 * undici's headers/body timeouts destroy that socket, which is what a stalled
 * Schwab or Yahoo call has to do.
 */
export function fetchWithTimeout(url: string, init: RequestInit = {}, ms = UPSTREAM_TIMEOUT_MS): Promise<Response> {
  const { signal: parent, ...rest } = init;
  return undiciFetch(url, {
    ...rest,
    signal: upstreamSignal(parent, ms),
    dispatcher: agentFor(ms),
  } as Parameters<typeof undiciFetch>[1]) as unknown as Promise<Response>;
}
