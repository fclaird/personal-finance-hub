import { logError, logLine } from "@/lib/log";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import { runSchwabRefresh } from "@/lib/schwab/refreshOrchestrator";

declare global {
  var __fhColdStartupPullScheduled: boolean | undefined;
}

/**
 * One-shot hydration after idle hours: unified Schwab refresh (closed bundle)
 * plus Finnhub earnings and internal jobs when CRON_SECRET is set.
 */
export async function runColdStartupDataPullOrchestration(): Promise<void> {
  if (isUsEquityRegularSessionOpen()) return;

  logLine("cold_startup_pull_begin");
  try {
    await runSchwabRefresh("closed", { reason: "cold_startup" });
    logLine("cold_startup_pull_schwab_ok");
  } catch (e) {
    logError("cold_startup_pull_schwab_failed", e);
  }

  const base = internalBaseUrl();
  try {
    await postJson(base, "/api/earnings/sync", {});
    logLine("cold_startup_pull_earnings_ok");
  } catch (e) {
    logError("cold_startup_pull_earnings_failed", e);
  }

  try {
    await postJson(base, "/api/earnings/enrich-schwab");
    logLine("cold_startup_pull_earnings_enrich_ok");
  } catch (e) {
    logError("cold_startup_pull_earnings_enrich_failed", e);
  }

  if (process.env.CRON_SECRET?.trim()) {
    try {
      await postJson(base, "/api/internal/portfolio-snapshots/weekly");
      logLine("cold_startup_pull_portfolio_weekly_ok");
    } catch (e) {
      logError("cold_startup_pull_portfolio_weekly_failed", e);
    }
    try {
      await postJson(base, "/api/internal/allocation-daily-close", {
        modes: ["auto", "schwab"],
      });
      logLine("cold_startup_pull_allocation_daily_ok");
    } catch (e) {
      logError("cold_startup_pull_allocation_daily_failed", e);
    }
  }

  logLine("cold_startup_pull_complete");
}

function internalBaseUrl(): string {
  const port = process.env.PORT ?? "3000";
  return (process.env.INTERNAL_APP_BASE_URL ?? `http://127.0.0.1:${port}`).replace(/\/+$/, "");
}

function cronHeaders(): HeadersInit {
  const secret = process.env.CRON_SECRET?.trim();
  if (!secret) return {};
  return { Authorization: `Bearer ${secret}` };
}

async function postJson(base: string, path: string, body?: unknown, extraHeaders?: HeadersInit): Promise<void> {
  const url = `${base}${path}`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      ...cronHeaders(),
      ...(extraHeaders ?? {}),
    },
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`${path} ${res.status}: ${t.slice(0, 300)}`);
  }
}

async function getOk(base: string, path: string): Promise<void> {
  const res = await fetch(`${base}${path}`, { method: "GET", headers: cronHeaders() });
  if (!res.ok) throw new Error(`${path} ${res.status}`);
}

/**
 * Runs once per Node process shortly after bootstrap when US equities RTH is closed.
 * Skipped during `next build` and on Vercel unless `FORCE_COLD_STARTUP_PULL_ON_VERCEL=1`.
 */
export function scheduleColdStartupDataPullOnce(): void {
  if (globalThis.__fhColdStartupPullScheduled) return;
  globalThis.__fhColdStartupPullScheduled = true;

  const phase = process.env.NEXT_PHASE ?? "";
  if (phase.toLowerCase().includes("build")) return;

  if (process.env.VERCEL === "1" && process.env.FORCE_COLD_STARTUP_PULL_ON_VERCEL !== "1") return;

  const delayMs =
    Number(process.env.COLD_STARTUP_PULL_DELAY_MS ?? "") > 0
      ? Number(process.env.COLD_STARTUP_PULL_DELAY_MS)
      : 3_500;

  setTimeout(() => {
    if (isUsEquityRegularSessionOpen()) {
      logLine("cold_startup_pull_skipped_rth_open");
      return;
    }
    void runColdStartupDataPullOrchestration();
  }, delayMs);
}
