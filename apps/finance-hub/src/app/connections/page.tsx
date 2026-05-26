"use client";

import { useEffect, useMemo, useState } from "react";

import { DraggableTileLayout } from "@/app/components/DraggableTileLayout";
import { EditablePageHeading } from "@/app/components/EditableHeading";
import { formatDisplayDateTime } from "@/lib/formatDate";
import { MAX_TRANSACTION_LOOKBACK_DAYS } from "@/lib/schwab/config";

type SyncResult = { ok: boolean; accounts?: number; error?: string };
type TxSyncResult = {
  ok: boolean;
  lookbackDays?: number;
  accountsUpdated?: number;
  transactionsUpserted?: number;
  classified?: number;
  error?: string;
};
type GreeksResult = { ok: boolean; updated?: number; error?: string };
type SchwabStatus =
  | { ok: true; connected: false }
  | {
      ok: true;
      connected: true;
      obtainedAt: number;
      expiresAt: number;
      expiresInSec: number;
      accessValid: boolean;
      scope: string | null;
      tokenType: string | null;
    }
  | { ok: false; error: string };

type PlaidHandler = { open: () => void };
type PlaidLink = {
  create: (args: { token: string; onSuccess: (public_token: string) => void }) => PlaidHandler;
};

declare global {
  interface Window {
    Plaid?: PlaidLink;
  }
}

export default function ConnectionsPage() {
  const [syncing, setSyncing] = useState(false);
  const [syncingTx, setSyncingTx] = useState(false);
  const [result, setResult] = useState<SyncResult | null>(null);
  const [txResult, setTxResult] = useState<TxSyncResult | null>(null);
  const [greeks, setGreeks] = useState<GreeksResult | null>(null);
  const [refreshingGreeks, setRefreshingGreeks] = useState(false);
  const [schwabStatus, setSchwabStatus] = useState<SchwabStatus | null>(null);
  const [checkingStatus, setCheckingStatus] = useState(false);

  const body = useMemo(() => {
    if (!result) return null;
    if (!result.ok) return `Error: ${result.error ?? "Unknown error"}`;
    return `Synced ${result.accounts ?? 0} account(s).`;
  }, [result]);

  const txBody = useMemo(() => {
    if (!txResult) return null;
    if (!txResult.ok) return `Transactions: ${txResult.error ?? "Unknown error"}`;
    const lb = txResult.lookbackDays != null ? ` · ${txResult.lookbackDays}d lookback` : "";
    return `Transactions: ${txResult.transactionsUpserted ?? 0} upserted, ${txResult.classified ?? 0} classified across ${txResult.accountsUpdated ?? 0} account(s)${lb}.`;
  }, [txResult]);

  async function loadSchwabStatus() {
    setCheckingStatus(true);
    try {
      const resp = await fetch("/api/schwab/status", { cache: "no-store" });
      const json = (await resp.json()) as SchwabStatus;
      setSchwabStatus(json);
    } catch (e) {
      setSchwabStatus({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setCheckingStatus(false);
    }
  }

  useEffect(() => {
    const t = setTimeout(() => {
      void loadSchwabStatus();
    }, 0);
    return () => clearTimeout(t);
  }, []);

  async function syncNow() {
    setSyncing(true);
    setResult(null);
    setGreeks(null);
    try {
      const resp = await fetch("/api/schwab/sync", { method: "POST" });
      const json = (await resp.json()) as SyncResult;
      setResult(json);
      await loadSchwabStatus();
    } catch (e) {
      setResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSyncing(false);
    }
  }

  async function syncTransactionsNow() {
    setSyncingTx(true);
    setTxResult(null);
    try {
      const resp = await fetch("/api/schwab/transactions/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ lookbackDays: MAX_TRANSACTION_LOOKBACK_DAYS }),
      });
      const json = (await resp.json()) as TxSyncResult;
      setTxResult(json);
      await loadSchwabStatus();
    } catch (e) {
      setTxResult({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setSyncingTx(false);
    }
  }

  async function refreshGreeks() {
    setRefreshingGreeks(true);
    setGreeks(null);
    try {
      const resp = await fetch("/api/schwab/refresh-greeks", { method: "POST" });
      const json = (await resp.json()) as GreeksResult;
      setGreeks(json);
      await loadSchwabStatus();
    } catch (e) {
      setGreeks({ ok: false, error: e instanceof Error ? e.message : String(e) });
    } finally {
      setRefreshingGreeks(false);
    }
  }

  return (
    <div className="flex w-full max-w-[84rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight">
          <EditablePageHeading pageId="connections" defaultTitle="Welcome" />
        </h1>
        <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
          This is local-only. Tokens are stored encrypted on disk using `FINANCE_HUB_PASSPHRASE`.
        </p>
      </div>

      <DraggableTileLayout
        storageKey="fh.connections.tiles.v1"
        defaultOrder={["schwab", "plaid"]}
        tiles={{
          schwab: {
            title: "Schwab",
            children: (
              <>
        <div className="flex items-start justify-between gap-4">
          <div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              Connect via OAuth, then sync holdings/positions into the local SQLite database.
            </div>
          </div>
          <a
            href="/api/schwab/start"
            className="shrink-0 rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {schwabStatus && schwabStatus.ok && schwabStatus.connected ? "Reconnect Schwab" : "Connect Schwab"}
          </a>
        </div>

        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 rounded-xl border border-zinc-300 bg-white/60 px-3 py-2 text-xs dark:border-white/20 dark:bg-black/20">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-zinc-700 dark:text-zinc-300">Status</span>
            {checkingStatus ? (
              <span className="text-zinc-600 dark:text-zinc-400">Checking…</span>
            ) : schwabStatus?.ok === true && schwabStatus.connected ? (
              <span className="rounded-full bg-emerald-100 px-2 py-0.5 font-semibold text-emerald-900 dark:bg-emerald-500/20 dark:text-emerald-200">
                Connected
              </span>
            ) : schwabStatus?.ok === true && schwabStatus.connected === false ? (
              <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-900 dark:bg-amber-500/20 dark:text-amber-200">
                Not connected
              </span>
            ) : schwabStatus?.ok === false ? (
              <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-900 dark:bg-red-950/40 dark:text-red-200">
                Error
              </span>
            ) : (
              <span className="text-zinc-600 dark:text-zinc-400">—</span>
            )}

            {schwabStatus?.ok === true && schwabStatus.connected ? (
              <span className="text-zinc-600 dark:text-zinc-400">
                Access token: {schwabStatus.accessValid ? "valid" : "expiring (will refresh on next API call)"} · Obtained{" "}
                {formatDisplayDateTime(new Date(schwabStatus.obtainedAt).toISOString())} · Expires{" "}
                {formatDisplayDateTime(new Date(schwabStatus.expiresAt).toISOString())}
              </span>
            ) : null}

            {schwabStatus?.ok === false ? (
              <span className="text-zinc-600 dark:text-zinc-400">{schwabStatus.error}</span>
            ) : null}
          </div>

          <button
            type="button"
            onClick={() => void loadSchwabStatus()}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Refresh status
          </button>
        </div>

        <div className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
          Note: Schwab connect requires `SCHWAB_CLIENT_ID`, `SCHWAB_CLIENT_SECRET`, and `SCHWAB_REDIRECT_URI` in `.env.local`.
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            onClick={syncNow}
            disabled={syncing}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            {syncing ? "Syncing…" : "Sync now"}
          </button>
          <button
            type="button"
            onClick={() => void syncTransactionsNow()}
            disabled={syncingTx}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
            title={`Pull TRADE history in 59-day API windows (up to ${MAX_TRANSACTION_LOOKBACK_DAYS} days per account — may take a few minutes). Schwab may not return data older than they retain.`}
          >
            {syncingTx ? "Syncing transactions…" : "Sync transactions"}
          </button>
          <button
            type="button"
            onClick={refreshGreeks}
            disabled={refreshingGreeks}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            {refreshingGreeks ? "Refreshing options…" : "Refresh option quotes & greeks"}
          </button>
          <a
            href="/api/health"
            className="text-sm text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400"
            target="_blank"
            rel="noreferrer"
          >
            View health
          </a>
        </div>

        {body ? (
          <div className="mt-4 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-800 dark:bg-black/40 dark:text-zinc-200">
            {body}
          </div>
        ) : null}

        {txBody ? (
          <div
            className={
              "mt-3 rounded-xl p-3 text-sm " +
              (txResult?.ok
                ? "bg-zinc-50 text-zinc-800 dark:bg-black/40 dark:text-zinc-200"
                : "bg-red-50 text-red-900 dark:bg-red-950/30 dark:text-red-200")
            }
          >
            {txBody}
          </div>
        ) : null}

        {greeks ? (
          <div className="mt-3 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-800 dark:bg-black/40 dark:text-zinc-200">
            {greeks.ok
              ? `Updated ${greeks.updated ?? 0} option quote(s) (marks + greeks).`
              : `Option refresh error: ${greeks.error ?? "Unknown error"}`}
          </div>
        ) : null}
              </>
            ),
          },
          plaid: {
            title: "Plaid (later)",
            children: (
              <>
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          We’ll add Plaid as an alternate ingestion path (and for Vanguard 529 later).
        </div>
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <button
            type="button"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
            onClick={async () => {
              const ensurePlaid = () =>
                new Promise<void>((resolve, reject) => {
                  if (window.Plaid) return resolve();
                  const s = document.createElement("script");
                  s.src = "https://cdn.plaid.com/link/v2/stable/link-initialize.js";
                  s.async = true;
                  s.onload = () => resolve();
                  s.onerror = () => reject(new Error("Failed to load Plaid Link script"));
                  document.head.appendChild(s);
                });

              await ensurePlaid();
              const ltResp = await fetch("/api/plaid/link-token", { method: "POST" });
              const raw = await ltResp.text().catch(() => "");
              let ltJson: { ok: boolean; link_token?: string; error?: string };
              try {
                ltJson = raw ? (JSON.parse(raw) as typeof ltJson) : { ok: false, error: "Empty response" };
              } catch {
                throw new Error(
                  `Plaid link token failed (${ltResp.status}): ${raw?.slice(0, 280) || "non-JSON body"}`,
                );
              }
              if (!ltJson.ok || !ltJson.link_token) {
                throw new Error(ltJson.error ?? `Failed to create link token (${ltResp.status})`);
              }

              const handler = window.Plaid?.create({
                token: ltJson.link_token,
                onSuccess: async (public_token: string) => {
                  await fetch("/api/plaid/exchange", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ public_token }),
                  });
                },
              });
              if (!handler) throw new Error("Plaid Link is not available");
              handler.open();
            }}
          >
            Connect Plaid
          </button>
          <button
            type="button"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
            onClick={async () => {
              await fetch("/api/plaid/sync", { method: "POST" });
            }}
          >
            Sync Plaid holdings
          </button>
        </div>
              </>
            ),
          },
        }}
      />
    </div>
  );
}

