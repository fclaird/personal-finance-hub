import type Database from "better-sqlite3";

import { getDb } from "@/lib/db";
import { logError, logLine } from "@/lib/log";
import type { DataMode } from "@/lib/dataMode";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import { runSchwabHoldingsSync } from "@/lib/schwab/holdingsSync";
import { runSchwabGreeksRefresh } from "@/lib/schwab/schwabGreeksRefresh";
import { runSchwabQuotesPersist } from "@/lib/schwab/schwabQuotesPersist";
import { runSchwabAccountValueSync } from "@/lib/schwab/schwabAccountValueSync";
import { runSchwabTaxonomySyncForPortfolio } from "@/lib/schwab/schwabTaxonomySync";

export type SchwabRefreshBundle = "rth" | "slow" | "closed";

export type SchwabRefreshStepResult = {
  step: string;
  ok: boolean;
  ms: number;
  error?: string;
  detail?: Record<string, unknown>;
};

export type SchwabRefreshRunResult = {
  ok: boolean;
  bundle: SchwabRefreshBundle;
  skipped?: boolean;
  reason?: string;
  runId?: number;
  steps: SchwabRefreshStepResult[];
};

declare global {
  var __fhSchwabRefreshRunning: Promise<SchwabRefreshRunResult> | undefined;
}

const RTH_FULL_SYNC = process.env.SCHWAB_RTH_FULL_SYNC === "1";

export function schwabRefreshPlan(bundle: SchwabRefreshBundle): {
  quotes: boolean;
  greeks: boolean;
  slow: boolean;
} {
  return {
    quotes: bundle === "rth" || bundle === "closed",
    greeks: bundle === "rth",
    slow: bundle === "slow" || bundle === "closed" || (bundle === "rth" && RTH_FULL_SYNC),
  };
}

async function runStep(
  step: string,
  fn: () => Promise<{ ok: boolean; error?: string } & Record<string, unknown>>,
): Promise<SchwabRefreshStepResult> {
  const t0 = Date.now();
  try {
    const res = await fn();
    const { ok, error, ...detail } = res;
    return {
      step,
      ok: ok !== false,
      ms: Date.now() - t0,
      error: error ?? undefined,
      detail: Object.keys(detail).length ? detail : undefined,
    };
  } catch (e) {
    return {
      step,
      ok: false,
      ms: Date.now() - t0,
      error: e instanceof Error ? e.message : String(e),
    };
  }
}

function insertRefreshRun(
  db: Database.Database,
  bundle: SchwabRefreshBundle,
  startedAt: string,
): number {
  const r = db
    .prepare(
      `INSERT INTO schwab_refresh_runs (mode, started_at, ok) VALUES (@mode, @started_at, 0)`,
    )
    .run({ mode: bundle, started_at: startedAt });
  return Number(r.lastInsertRowid);
}

function finishRefreshRun(
  db: Database.Database,
  runId: number,
  ok: boolean,
  steps: SchwabRefreshStepResult[],
  quotesSymbols: number | null,
  holdingsAsOf: string | null,
) {
  db.prepare(
    `
    UPDATE schwab_refresh_runs
    SET finished_at = @finished_at,
        ok = @ok,
        steps_json = @steps_json,
        quotes_symbols = @quotes_symbols,
        holdings_as_of = @holdings_as_of
    WHERE id = @id
  `,
  ).run({
    id: runId,
    finished_at: new Date().toISOString(),
    ok: ok ? 1 : 0,
    steps_json: JSON.stringify(steps),
    quotes_symbols: quotesSymbols,
    holdings_as_of: holdingsAsOf,
  });
}

export async function runSchwabRefresh(
  bundle: SchwabRefreshBundle,
  opts?: { db?: Database.Database; dataMode?: DataMode; reason?: string },
): Promise<SchwabRefreshRunResult> {
  if (globalThis.__fhSchwabRefreshRunning) {
    return { ok: false, bundle, skipped: true, reason: "refresh_in_flight", steps: [] };
  }

  const runPromise = (async (): Promise<SchwabRefreshRunResult> => {
    const db = opts?.db ?? getDb();
    const startedAt = new Date().toISOString();
    const runId = insertRefreshRun(db, bundle, startedAt);
    const steps: SchwabRefreshStepResult[] = [];
    let holdingsAsOf: string | null = null;
    let quotesSymbols: number | null = null;

    logLine(`schwab_refresh_begin bundle=${bundle} reason=${opts?.reason ?? "scheduler"}`);

    const { quotes: includeQuotes, greeks: includeGreeks, slow: includeSlow } = schwabRefreshPlan(bundle);

    if (includeQuotes) {
      const q = await runStep("quotes", async () => {
        const res = await runSchwabQuotesPersist(db);
        quotesSymbols = res.symbols;
        return res;
      });
      steps.push(q);
    }

    if (includeGreeks) {
      steps.push(await runStep("greeks", () => runSchwabGreeksRefresh(db)));
    }

    if (includeSlow) {
      const h = await runStep("holdings", async () => {
        const res = await runSchwabHoldingsSync({ db, dataMode: opts?.dataMode });
        if (res.holdingsAsOf) holdingsAsOf = res.holdingsAsOf;
        return res;
      });
      steps.push(h);

      steps.push(
        await runStep("taxonomy", async () =>
          runSchwabTaxonomySyncForPortfolio(db, { refreshMarketCapsFromSchwab: bundle === "closed" }),
        ),
      );

      steps.push(await runStep("account_value", () => runSchwabAccountValueSync(db)));
    }

    const ok = steps.length === 0 || steps.every((s) => s.ok);
    finishRefreshRun(db, runId, ok, steps, quotesSymbols, holdingsAsOf);
    logLine(`schwab_refresh_complete bundle=${bundle} ok=${ok}`);
    return { ok, bundle, runId, steps };
  })();

  globalThis.__fhSchwabRefreshRunning = runPromise;
  try {
    return await runPromise;
  } finally {
    globalThis.__fhSchwabRefreshRunning = undefined;
  }
}

/** Scheduler tick: RTH fast bundle every call; slow bundle when due. */
export async function runSchwabRefreshSchedulerTick(opts?: {
  lastSlowRunAt: number;
  slowIntervalMs: number;
  dataMode?: DataMode;
}): Promise<{ lastSlowRunAt: number }> {
  const slowIntervalMs = opts?.slowIntervalMs ?? 600_000;
  let lastSlowRunAt = opts?.lastSlowRunAt ?? 0;
  const now = Date.now();
  const rth = isUsEquityRegularSessionOpen(new Date());

  if (rth) {
    await runSchwabRefresh("rth", { dataMode: opts?.dataMode, reason: "scheduler_rth" });
    if (now - lastSlowRunAt >= slowIntervalMs) {
      await runSchwabRefresh("slow", { dataMode: opts?.dataMode, reason: "scheduler_slow" });
      lastSlowRunAt = now;
    }
  } else if (now - lastSlowRunAt >= slowIntervalMs) {
    await runSchwabRefresh("closed", { dataMode: opts?.dataMode, reason: "scheduler_closed" });
    lastSlowRunAt = now;
  }

  return { lastSlowRunAt };
}
