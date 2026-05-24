"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { DraggableTileLayout } from "@/app/components/DraggableTileLayout";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { SymbolLink } from "@/app/components/SymbolLink";
import { formatUsdCompact } from "@/lib/format";
import { formatDisplayDate } from "@/lib/formatDate";

type Row = {
  id: string;
  symbol: string;
  earnings_date: string;
  fiscal_period_end: string | null;
  time_of_day: string | null;
  source: string;
  iv_current: number | null;
  iv_52w_high: number | null;
  iv_52w_low: number | null;
  iv_rank_pct: number | null;
  hist_vol_30d: number | null;
  iv_over_hist_vol: number | null;
  avg_dollar_volume_20d: number | null;
  dollar_liquidity_score: number | null;
  opportunity_score: number | null;
  metrics_source: string | null;
  metrics_updated_at: string | null;
  days_to_earnings: number;
};

const PCT1 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 1, maximumFractionDigits: 1 });

function pct1(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return `${PCT1.format(x)}%`;
}

/** 20-day average dollar volume (close × shares). */
function compactAdvUsd(v: number | null | undefined, masked: boolean): string {
  return formatUsdCompact(v, { mask: masked });
}

/** Stored as annualized decimal (e.g. 0.42 → 42%). */
function ivHistPct(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  const p = x <= 2 ? x * 100 : x;
  return `${PCT1.format(p)}%`;
}

function ratio2(x: number | null | undefined): string {
  if (x == null || !Number.isFinite(x)) return "—";
  return x.toFixed(2);
}

export default function EarningsPage() {
  const privacy = usePrivacy();
  const [rows, setRows] = useState<Row[]>([]);
  const [finnhubConfigured, setFinnhubConfigured] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    const today = new Date().toISOString().slice(0, 10);
    const to = new Date(Date.now() + 50 * 86400000).toISOString().slice(0, 10);
    const resp = await fetch(`/api/earnings?from=${today}&to=${to}`);
    const json = (await resp.json()) as { ok: boolean; rows?: Row[]; finnhubConfigured?: boolean; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to load earnings");
    setRows(json.rows ?? []);
    setFinnhubConfigured(!!json.finnhubConfigured);
  }, []);

  useEffect(() => {
    void (async () => {
      try {
        await load();
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [load]);

  const sorted = useMemo(() => [...rows].sort((a, b) => (b.opportunity_score ?? 0) - (a.opportunity_score ?? 0)), [rows]);

  async function syncFinnhub() {
    setLoading(true);
    setMsg(null);
    setError(null);
    try {
      const resp = await fetch("/api/earnings/sync", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ finnhub: true, daysAhead: 28 }),
      });
      const json = (await resp.json()) as {
        ok: boolean;
        error?: string;
        eventsUpserted?: number;
        calendarRows?: number;
        volumeFetches?: number;
      };
      if (!json.ok) throw new Error(json.error ?? "Sync failed");
      setMsg(
        `Finnhub: ${json.calendarRows ?? 0} calendar row(s), ${json.eventsUpserted ?? 0} event(s), ${json.volumeFetches ?? 0} liquidity fetch(es). IV still needs Schwab (or manual) for full rank.`,
      );
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function enrichSchwab() {
    setLoading(true);
    setMsg(null);
    setError(null);
    try {
      const resp = await fetch("/api/earnings/enrich-schwab", { method: "POST" });
      const json = (await resp.json()) as { ok: boolean; message?: string };
      if (!json.ok) throw new Error("Enrich failed");
      setMsg(json.message ?? "Schwab enrich stub.");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }

  async function pullEarningsData() {
    await syncFinnhub();
  }

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Earnings opportunities</h1>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Rank names with upcoming earnings by <span className="font-medium text-zinc-800 dark:text-zinc-200">IV vs its 52-week range</span>{" "}
            (elevated = more “event” premium) and{" "}
            <span className="font-medium text-zinc-800 dark:text-zinc-200">typical dollar liquidity</span> (20-day average share volume × close — how tradable the name is vs
            most stocks, not a short-term volume spike). Schwab can supply IV later; Finnhub fills liquidity from daily candles when configured.
          </p>
        </div>
        <Link
          href="/connections"
          className="shrink-0 rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
        >
          Connections
        </Link>
      </div>

      <DraggableTileLayout
        storageKey="fh.earnings.tiles.v1"
        defaultOrder={["sync", "ranked"]}
        tiles={{
          sync: {
            title: "Sync & refresh",
            children: (
              <>
        <div className="flex flex-wrap items-center gap-3">
          <button
            type="button"
            disabled={loading}
            onClick={() => void pullEarningsData()}
            title={
              finnhubConfigured
                ? "Fetch Finnhub calendar and 20-day average dollar volume per symbol"
                : "Set FINNHUB_API_KEY in .env.local"
            }
            className="rounded-full bg-zinc-950 px-5 py-2.5 text-sm font-semibold text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            Pull earnings data (Finnhub)
          </button>
          <button
            type="button"
            disabled={loading || !finnhubConfigured}
            onClick={() => void syncFinnhub()}
            title={!finnhubConfigured ? "Set FINNHUB_API_KEY in .env.local" : undefined}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Sync Finnhub calendar + liquidity
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void enrichSchwab()}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Enrich IV (Schwab stub)
          </button>
          <button
            type="button"
            disabled={loading}
            onClick={() => void load()}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Refresh
          </button>
        </div>
        {!finnhubConfigured ? (
          <p className="mt-3 text-xs text-zinc-600 dark:text-zinc-400">
            Add <span className="font-mono">FINNHUB_API_KEY</span> to <span className="font-mono">.env.local</span> for calendar + 20d dollar liquidity. Use{" "}
            <span className="font-mono">EARNINGS_WATCHLIST=SYM1,SYM2</span> when Finnhub needs per-ticker calendar queries.
          </p>
        ) : null}
        {msg ? <div className="mt-4 rounded-xl bg-zinc-50 p-3 text-sm text-zinc-800 dark:bg-white/5 dark:text-zinc-200">{msg}</div> : null}
        {error ? (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>
        ) : null}
              </>
            ),
          },
          ranked: {
            title: "Ranked upcoming",
            children: (
              <>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          Score blends IV rank (when present) with dollar liquidity (0–100, log-scaled vs typical listed names: ~$1M/day low, ~$1B/day high). IV and HV30 are annualized
          decimals; IV/HV is implied vs realized vol in demo.
        </p>
        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
                <th className="py-2 pr-4 font-medium">Symbol</th>
                <th className="py-2 pr-4 font-medium">Earnings</th>
                <th className="py-2 pr-4 text-right font-medium">Days</th>
                <th className="py-2 pr-4 font-medium">Time</th>
                <th className="py-2 pr-4 text-right font-medium">IV</th>
                <th className="py-2 pr-4 text-right font-medium">HV30</th>
                <th className="py-2 pr-4 text-right font-medium">IV/HV</th>
                <th className="py-2 pr-4 text-right font-medium">IV rank</th>
                <th className="py-2 pr-4 text-right font-medium">20d $ADV</th>
                <th className="py-2 pr-4 text-right font-medium">Liq score</th>
                <th className="py-2 pr-4 text-right font-medium">Score</th>
                <th className="py-2 pr-4 font-medium">Source</th>
              </tr>
            </thead>
            <tbody>
              {sorted.map((r) => (
                <tr key={r.id} className="border-b border-zinc-200 dark:border-white/20">
                  <td className="py-2 pr-4 font-medium">
                    <SymbolLink symbol={r.symbol}>{r.symbol}</SymbolLink>
                  </td>
                  <td className="py-2 pr-4 tabular-nums">{formatDisplayDate(r.earnings_date)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{r.days_to_earnings}</td>
                  <td className="py-2 pr-4 uppercase text-zinc-600 dark:text-zinc-400">{(r.time_of_day ?? "—").toString()}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{ivHistPct(r.iv_current)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{ivHistPct(r.hist_vol_30d)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{ratio2(r.iv_over_hist_vol)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{pct1(r.iv_rank_pct)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{compactAdvUsd(r.avg_dollar_volume_20d, privacy.masked)}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {r.dollar_liquidity_score != null && Number.isFinite(r.dollar_liquidity_score)
                      ? String(Math.round(r.dollar_liquidity_score))
                      : "—"}
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums font-semibold text-zinc-900 dark:text-zinc-100">
                    {r.opportunity_score != null ? PCT1.format(r.opportunity_score) : "—"}
                  </td>
                  <td className="py-2 pr-4 text-xs text-zinc-600 dark:text-zinc-400">
                    {r.source} / {r.metrics_source ?? "—"}
                  </td>
                </tr>
              ))}
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={12} className="py-8 text-center text-zinc-600 dark:text-zinc-400">
                    No earnings rows in range. Sync Finnhub.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
              </>
            ),
          },
        }}
      />
    </div>
  );
}
