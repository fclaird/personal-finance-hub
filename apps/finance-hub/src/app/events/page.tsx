"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import { SymbolLink } from "@/app/components/SymbolLink";
import { formatDisplayDate } from "@/lib/formatDate";
import { formatUsd2 } from "@/lib/format";

const FRAME =
  "box-border flex w-full min-w-0 max-w-none flex-1 flex-col gap-6 overflow-x-clip py-6 pl-4 pr-5 sm:py-8 sm:pl-6 sm:pr-8 [&>*]:min-w-0 [&>*]:max-w-full";
const CARD_GRID = "grid min-w-0 grid-cols-[repeat(auto-fit,minmax(min(100%,22rem),1fr))] items-start gap-4 [&>*]:min-w-0";
const CARD = "min-w-0 overflow-hidden rounded-2xl border border-zinc-300 bg-white shadow-sm dark:border-white/20 dark:bg-zinc-950";

type Watchlist = { id: string; name: string; itemCount: number };
type EventRow = { id: string; kind: string; date: string; symbol: string | null; label: string; source: string };
type Flagged = { positionId: string; underlying: string; expiry: string; label: string; events: EventRow[] };
type Move = {
  symbol: string;
  spot: number;
  expiry: string;
  strike: number;
  moveDollars: number;
  movePct: number;
  ivMoveDollars: number | null;
  ivMovePct: number | null;
  source: string;
  delayed: boolean;
  servedFrom: string;
};
type Payload = {
  ok: boolean;
  error?: string;
  symbols?: string[];
  events?: EventRow[];
  flagged?: Flagged[];
  moves?: Move[];
  sources?: Record<string, string>;
  gaps?: string[];
};

function kindLabel(kind: string): string {
  if (kind === "ex-dividend") return "Ex-dividend";
  if (kind === "fomc") return "FOMC";
  return "Earnings";
}

export default function EventsPage() {
  const { masked } = usePrivacy();
  const [watchlists, setWatchlists] = useState<Watchlist[]>([]);
  const [watchlistId, setWatchlistId] = useState("");
  const [days, setDays] = useState("90");
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async (nextWatchlist: string, nextDays: string) => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({ days: nextDays, moves: "1" });
      if (nextWatchlist) params.set("watchlistId", nextWatchlist);
      const resp = await fetch(`/api/events/calendar?${params}`, { cache: "no-store" });
      const json = (await resp.json()) as Payload;
      if (!json.ok) throw new Error(json.error ?? "Could not load the calendar");
      setData(json);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetch("/api/watchlists", { cache: "no-store" })
      .then((resp) => resp.json())
      .then((json: { watchlists?: Watchlist[] }) => setWatchlists(json.watchlists ?? []))
      .catch(() => setWatchlists([]));
  }, []);

  useEffect(() => {
    void load(watchlistId, days);
  }, [load, watchlistId, days]);

  const events = data?.events ?? [];
  const flagged = data?.flagged ?? [];
  const moves = data?.moves ?? [];

  return (
    <div className={FRAME}>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-950 dark:text-zinc-50">Events</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-700 dark:text-zinc-300">
            Upcoming earnings, ex-dividend dates, and FOMC decisions for names you hold and an optional watchlist. Expected move is the nearest-expiry at-the-money straddle, with an IV move beside it. Nothing here places an order.
          </p>
        </div>
        <Link href="/earnings" className="text-sm font-medium text-zinc-900 underline-offset-4 hover:underline dark:text-zinc-100">
          Earnings scores
        </Link>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Watchlist
          <select
            aria-label="Watchlist"
            value={watchlistId}
            onChange={(event) => setWatchlistId(event.target.value)}
            className="mt-1 block rounded border border-zinc-400 bg-white px-2 py-1.5 text-sm text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark]"
          >
            <option value="">Held names only</option>
            {watchlists.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name} ({row.itemCount})
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-medium text-zinc-600 dark:text-zinc-300">
          Window
          <select
            aria-label="Calendar window"
            value={days}
            onChange={(event) => setDays(event.target.value)}
            className="mt-1 block rounded border border-zinc-400 bg-white px-2 py-1.5 text-sm text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark]"
          >
            <option value="30">30 days</option>
            <option value="90">90 days</option>
            <option value="180">180 days</option>
          </select>
        </label>
        <p className="pb-1 text-xs text-zinc-600 dark:text-zinc-300">{loading ? "Loading chains and dates…" : `${data?.symbols?.length ?? 0} names`}</p>
      </div>

      {error ? <p className="rounded-lg border border-rose-400 px-3 py-2 text-sm text-rose-800 dark:text-rose-200">{error}</p> : null}
      {(data?.gaps ?? []).length > 0 ? (
        <ul className="space-y-1 rounded-xl border border-amber-400/70 bg-zinc-950 px-3 py-2 text-sm text-amber-100">
          {data?.gaps?.map((gap) => (
            <li key={gap}>{gap}</li>
          ))}
        </ul>
      ) : null}

      <section className={CARD}>
        <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-white/10">Calendar</h2>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[40rem] text-left text-sm">
            <thead className="text-xs uppercase tracking-wide text-zinc-500 dark:text-zinc-300">
              <tr>
                <th className="px-4 py-2 font-medium">Date</th>
                <th className="px-4 py-2 font-medium">Kind</th>
                <th className="px-4 py-2 font-medium">Name</th>
                <th className="px-4 py-2 font-medium">Detail</th>
              </tr>
            </thead>
            <tbody>
              {events.length === 0 ? (
                <tr>
                  <td colSpan={4} className="px-4 py-6 text-zinc-600 dark:text-zinc-300">
                    No events in this window.
                  </td>
                </tr>
              ) : (
                events.map((event) => (
                  <tr key={event.id} className="border-t border-zinc-200 dark:border-white/10">
                    <td className="px-4 py-2 tabular-nums">{formatDisplayDate(event.date)}</td>
                    <td className="px-4 py-2">{kindLabel(event.kind)}</td>
                    <td className="px-4 py-2">{event.symbol ? <SymbolLink symbol={event.symbol} /> : "Market"}</td>
                    <td className="px-4 py-2 text-zinc-700 dark:text-zinc-300">{event.label}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <div className={CARD_GRID}>
        <section className={CARD}>
          <h2 className="border-b border-zinc-200 px-4 py-3 text-sm font-semibold dark:border-white/10">Options with an event before expiry</h2>
          <ul className="space-y-3 px-4 py-3 text-sm">
            {flagged.length === 0 ? <li className="text-zinc-600 dark:text-zinc-300">No open option expires after one of these events.</li> : null}
            {flagged.map((row) => (
              <li key={row.positionId}>
                <p className="font-medium">
                  <SymbolLink symbol={row.underlying} /> · expires {formatDisplayDate(row.expiry)}
                </p>
                <p className="text-zinc-600 dark:text-zinc-300">{row.label}</p>
                <p className="text-amber-800 dark:text-amber-200">
                  {row.events.map((event) => `${kindLabel(event.kind)} ${formatDisplayDate(event.date)}`).join(" · ")}
                </p>
              </li>
            ))}
          </ul>
        </section>
        <section className={`${CARD} px-4 py-3 text-xs leading-5 text-zinc-600 dark:text-zinc-300`}>
          <h2 className="mb-2 text-sm font-semibold text-zinc-900 dark:text-zinc-100">Where this comes from</h2>
          <ul className="space-y-2">
            {Object.entries(data?.sources ?? {}).map(([key, text]) => (
              <li key={key}>{text}</li>
            ))}
          </ul>
        </section>
      </div>

      <section>
        <h2 className="mb-3 text-sm font-semibold">Expected move</h2>
        <div className={CARD_GRID}>
          {moves.length === 0 ? <p className="text-sm text-zinc-600 dark:text-zinc-300">No straddle quote yet.</p> : null}
          {moves.map((move) => (
            <article key={move.symbol} className={`${CARD} px-4 py-3`}>
              <p className="text-base font-semibold">
                <SymbolLink symbol={move.symbol} />
              </p>
              <p className="mt-1 text-xs font-medium uppercase tracking-wide text-zinc-600 dark:text-zinc-300">Straddle</p>
              <p className="text-2xl font-semibold tabular-nums">
                {formatUsd2(move.moveDollars, { mask: masked })}{" "}
                <span className="text-base font-medium text-zinc-600 dark:text-zinc-300">{(move.movePct * 100).toFixed(1)}%</span>
              </p>
              <p className="mt-2 text-sm tabular-nums text-zinc-800 dark:text-zinc-200">
                IV move{" "}
                {move.ivMoveDollars == null || move.ivMovePct == null
                  ? "—"
                  : `${formatUsd2(move.ivMoveDollars, { mask: masked })} ${(move.ivMovePct * 100).toFixed(1)}%`}
              </p>
              <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-300">
                {move.source}
                {move.delayed ? " delayed" : ""} · {move.servedFrom} · {formatDisplayDate(move.expiry)} {move.strike} straddle · spot{" "}
                {formatUsd2(move.spot, { mask: masked })}
              </p>
            </article>
          ))}
        </div>
      </section>
    </div>
  );
}
