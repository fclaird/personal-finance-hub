"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import { SymbolLink } from "@/app/components/SymbolLink";
import { formatInt, formatSignedUsd2, formatUsd2 } from "@/lib/format";

const FRAME =
  "box-border flex w-full min-w-0 max-w-none flex-1 flex-col gap-6 overflow-x-clip py-6 pl-4 pr-5 sm:py-8 sm:pl-6 sm:pr-8 [&>*]:min-w-0 [&>*]:max-w-full";
const CARD_GRID = "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,26rem),1fr))] items-start gap-4 [&>*]:min-w-0";
const CARD = "min-w-0 overflow-hidden rounded-2xl border border-zinc-300 bg-white shadow-sm dark:border-white/20 dark:bg-zinc-950";
const FIELD = "mt-1 block w-full rounded border border-zinc-400 bg-white px-2 py-1.5 text-sm text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark]";

type Watchlist = { id: string; name: string; itemCount: number };
type Row = {
  symbol: string;
  last: number | null;
  change: number | null;
  changePercent: number | null;
  volume: number | null;
  ivRankPct: number | null;
  atmIv: number | null;
};
type AlertRow = {
  id: string;
  kind: "price" | "iv-spike" | "profit-target";
  symbol: string;
  enabled: boolean;
  config: { direction?: "above" | "below"; level?: number; minRankPct?: number; targetPnl?: number };
};
type EventRow = { id: string; title: string; severity: string; occurred_at: string; rule_type: string };
type Board = { ok: boolean; error?: string; rows?: Row[]; gaps?: string[]; sources?: Record<string, string> };

function alertText(alert: AlertRow): string {
  if (alert.kind === "price") return `${alert.config.direction === "below" ? "At or below" : "At or above"} ${alert.config.level}`;
  if (alert.kind === "iv-spike") return `IV rank at least ${alert.config.minRankPct}%`;
  return `Open P&L at least ${alert.config.targetPnl}`;
}

export default function MonitorPage() {
  const { masked } = usePrivacy();
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [watchlistId, setWatchlistId] = useState("");
  const [board, setBoard] = useState<Board | null>(null);
  const [alerts, setAlerts] = useState<AlertRow[]>([]);
  const [events, setEvents] = useState<EventRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<AlertRow["kind"]>("price");
  const [symbol, setSymbol] = useState("");
  const [direction, setDirection] = useState<"above" | "below">("above");
  const [level, setLevel] = useState("");
  const [minRankPct, setMinRankPct] = useState("80");
  const [targetPnl, setTargetPnl] = useState("500");

  const loadEvents = useCallback(async () => {
    const resp = await fetch("/api/alerts/events?limit=40", { cache: "no-store" });
    const json = (await resp.json()) as { events?: EventRow[] };
    setEvents((json.events ?? []).filter((event) => event.rule_type === "watch"));
  }, []);

  const load = useCallback(async (nextWatchlist: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (nextWatchlist) params.set("watchlistId", nextWatchlist);
      const [boardResp, alertResp] = await Promise.all([
        fetch(`/api/watchlist-monitor?${params}`, { cache: "no-store" }),
        fetch("/api/watch-alerts", { cache: "no-store" }),
      ]);
      const boardJson = (await boardResp.json()) as Board;
      const alertJson = (await alertResp.json()) as { ok: boolean; alerts?: AlertRow[]; error?: string };
      if (!boardJson.ok) throw new Error(boardJson.error ?? "Could not load the board");
      if (!alertJson.ok) throw new Error(alertJson.error ?? "Could not load alerts");
      setBoard(boardJson);
      setAlerts(alertJson.alerts ?? []);
      await loadEvents();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, [loadEvents]);

  useEffect(() => {
    void fetch("/api/watchlists", { cache: "no-store" })
      .then((resp) => resp.json())
      .then((json: { watchlists?: Watchlist[] }) => setWatchlists(json.watchlists ?? []))
      .catch(() => setWatchlists([]));
  }, []);

  useEffect(() => {
    void load(watchlistId);
  }, [load, watchlistId]);

  async function addAlert() {
    setError(null);
    const body =
      kind === "price"
        ? { kind, symbol, direction, level: Number(level) }
        : kind === "iv-spike"
          ? { kind, symbol, minRankPct: Number(minRankPct) }
          : { kind, symbol, targetPnl: Number(targetPnl) };
    const resp = await fetch("/api/watch-alerts", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const json = (await resp.json()) as { ok: boolean; error?: string; alerts?: AlertRow[] };
    if (!json.ok) {
      setError(json.error ?? "Could not save the alert");
      return;
    }
    setAlerts(json.alerts ?? []);
    setSymbol("");
  }

  async function runAlerts() {
    setError(null);
    const params = watchlistId ? `?watchlistId=${encodeURIComponent(watchlistId)}` : "";
    const resp = await fetch(`/api/watch-alerts/run${params}`, { method: "POST" });
    const json = (await resp.json()) as { ok: boolean; error?: string; quoteNote?: string | null };
    if (!json.ok) {
      setError(json.error ?? "Could not run alerts");
      return;
    }
    if (json.quoteNote) setError(json.quoteNote);
    await loadEvents();
  }

  const rows = board?.rows ?? [];

  return (
    <div className={FRAME}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Watchlist</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-700 dark:text-zinc-300">
            Price, day change, volume, and IV rank for a watchlist or your held names. Alerts stay in the app. Nothing here places an order.
          </p>
        </div>
        <Link href="/alerts" className="text-sm font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-100">
          All alerts
        </Link>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Board
          <select aria-label="Watchlist" value={watchlistId} onChange={(event) => setWatchlistId(event.target.value)} className={FIELD}>
            <option value="">Held names</option>
            {watchlists.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} ({row.itemCount})
              </option>
            ))}
          </select>
        </label>
        <button type="button" onClick={() => void load(watchlistId)} className="rounded-full border border-zinc-400 px-3 py-1.5 text-sm font-semibold dark:border-zinc-400">
          {loading ? "Refreshing" : "Refresh"}
        </button>
        <Link href="/terminal/watchlists" className="pb-1 text-sm underline-offset-4 hover:underline">
          Edit watchlists
        </Link>
      </div>

      {error ? <p className="rounded-lg border border-rose-400 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">{error}</p> : null}
      {(board?.gaps ?? []).length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-amber-400/70 bg-zinc-950 px-3 py-2 text-sm text-amber-100">
          {board?.gaps?.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      ) : null}

      <section className={CARD}>
        <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-white/10">Live board</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[48rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-300">
              <tr>
                <th className="px-4 py-2 font-medium">Symbol</th>
                <th className="px-4 py-2 font-medium">Last</th>
                <th className="px-4 py-2 font-medium">Day change</th>
                <th className="px-4 py-2 font-medium">Volume</th>
                <th className="px-4 py-2 font-medium">IV rank</th>
              </tr>
            </thead>
            <tbody>
              {rows.length === 0 ? (
                <tr>
                  <td colSpan={5} className="px-4 py-6 text-zinc-600 dark:text-zinc-300">
                    No symbols on this board.
                  </td>
                </tr>
              ) : (
                rows.map((row) => (
                  <tr key={row.symbol} className="border-t border-zinc-200 dark:border-white/10">
                    <td className="px-4 py-2">
                      <SymbolLink symbol={row.symbol} />
                    </td>
                    <td className="px-4 py-2 tabular-nums">{formatUsd2(row.last, { mask: masked })}</td>
                    <td className="px-4 py-2 tabular-nums">
                      {formatSignedUsd2(row.change, { mask: masked })}
                      {row.changePercent != null ? ` (${(row.changePercent * 100).toFixed(2)}%)` : ""}
                    </td>
                    <td className="px-4 py-2 tabular-nums">{row.volume == null ? "—" : formatInt(row.volume)}</td>
                    <td className="px-4 py-2 tabular-nums">{row.ivRankPct == null ? "—" : `${row.ivRankPct.toFixed(0)}%`}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className={CARD_GRID}>
        <section className={`${CARD} px-4 py-3`}>
          <h2 className="text-sm font-semibold">New alert</h2>
          <div className="mt-3 grid gap-3">
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Symbol
              <input aria-label="Alert symbol" value={symbol} onChange={(event) => setSymbol(event.target.value.toUpperCase())} className={FIELD} />
            </label>
            <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
              Kind
              <select aria-label="Alert kind" value={kind} onChange={(event) => setKind(event.target.value as AlertRow["kind"])} className={FIELD}>
                <option value="price">Price level</option>
                <option value="iv-spike">IV rank spike</option>
                <option value="profit-target">Profit target</option>
              </select>
            </label>
            {kind === "price" ? (
              <div className="grid grid-cols-2 gap-3">
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Side
                  <select aria-label="Price side" value={direction} onChange={(event) => setDirection(event.target.value as "above" | "below")} className={FIELD}>
                    <option value="above">At or above</option>
                    <option value="below">At or below</option>
                  </select>
                </label>
                <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                  Price
                  <input aria-label="Price level" type="number" value={level} onChange={(event) => setLevel(event.target.value)} className={FIELD} />
                </label>
              </div>
            ) : null}
            {kind === "iv-spike" ? (
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                IV rank at least
                <input aria-label="IV rank threshold" type="number" value={minRankPct} onChange={(event) => setMinRankPct(event.target.value)} className={FIELD} />
              </label>
            ) : null}
            {kind === "profit-target" ? (
              <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
                Open P&L at least
                <input aria-label="Profit target" type="number" value={targetPnl} onChange={(event) => setTargetPnl(event.target.value)} className={FIELD} />
              </label>
            ) : null}
            <button type="button" onClick={() => void addAlert()} className="rounded bg-zinc-950 px-3 py-1.5 text-sm font-semibold text-white dark:bg-zinc-100 dark:text-zinc-950">
              Save alert
            </button>
          </div>
          <ul className="mt-4 space-y-2 text-sm">
            {alerts.length === 0 ? <li className="text-zinc-600 dark:text-zinc-300">No saved alerts.</li> : null}
            {alerts.map((alert) => (
              <li key={alert.id} className="flex items-center justify-between gap-2">
                <span>
                  <SymbolLink symbol={alert.symbol} /> · {alertText(alert)}
                  {alert.enabled ? "" : " (off)"}
                </span>
                <button
                  type="button"
                  className="text-xs underline-offset-2 hover:underline"
                  onClick={() => void fetch(`/api/watch-alerts?id=${encodeURIComponent(alert.id)}`, { method: "DELETE" }).then(() => load(watchlistId))}
                >
                  Remove
                </button>
              </li>
            ))}
          </ul>
        </section>
        <section className={`${CARD} px-4 py-3`}>
          <div className="flex items-center justify-between gap-2">
            <h2 className="text-sm font-semibold">In-app alerts</h2>
            <button type="button" onClick={() => void runAlerts()} className="rounded-full border border-zinc-400 px-3 py-1 text-xs font-semibold dark:border-zinc-400">
              Check now
            </button>
          </div>
          <p className="mt-2 text-xs text-zinc-600 dark:text-zinc-300">
            Check now compares saved lines with Schwab quotes and open P&L, then stores a row for today. There is an in-process notice hook and no email or push channel.
          </p>
          <ul className="mt-3 space-y-2 text-sm">
            {events.length === 0 ? <li className="text-zinc-600 dark:text-zinc-300">No watch alerts yet.</li> : null}
            {events.map((event) => (
              <li key={event.id}>
                <span className="font-medium">{event.title}</span>
                <span className="ml-2 text-xs text-zinc-600 dark:text-zinc-300">{event.occurred_at}</span>
              </li>
            ))}
          </ul>
          <ul className="mt-4 space-y-2 text-xs leading-5 text-zinc-600 dark:text-zinc-300">
            {Object.values(board?.sources ?? {}).map((text) => (
              <li key={text}>{text}</li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
