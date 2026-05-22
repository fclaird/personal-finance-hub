"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";

import { SymbolLink } from "@/app/components/SymbolLink";

type WatchlistRow = { id: string; name: string; createdAt: string; itemCount: number };

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

export default function TerminalWatchlistsPage() {
  const [watchlists, setWatchlists] = useState<WatchlistRow[]>([]);
  const [activeId, setActiveId] = useState<string | null>(null);
  const [items, setItems] = useState<Array<{ symbol: string; createdAt: string }>>([]);
  const [newName, setNewName] = useState("");
  const [newSym, setNewSym] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function loadWatchlists() {
    const resp = await fetch("/api/watchlists", { cache: "no-store" });
    const json = (await resp.json()) as { ok: boolean; watchlists?: WatchlistRow[]; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to load watchlists");
    setWatchlists(json.watchlists ?? []);
  }

  async function loadItems(watchlistId: string) {
    const resp = await fetch(`/api/watchlists/items?watchlistId=${encodeURIComponent(watchlistId)}`, { cache: "no-store" });
    const json = (await resp.json()) as { ok: boolean; items?: Array<{ symbol: string; createdAt: string }>; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to load watchlist items");
    setItems(json.items ?? []);
  }

  const refreshCb = useCallback(async () => {
    setError(null);
    try {
      await loadWatchlists();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, []);

  useEffect(() => {
    const t = setTimeout(() => void refreshCb(), 0);
    return () => clearTimeout(t);
  }, [refreshCb]);

  useEffect(() => {
    if (!activeId) return;
    const t = setTimeout(() => void loadItems(activeId).catch((e) => setError(e instanceof Error ? e.message : String(e))), 0);
    return () => clearTimeout(t);
  }, [activeId]);

  const active = useMemo(() => watchlists.find((w) => w.id === activeId) ?? null, [watchlists, activeId]);

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Terminal watchlists</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Add symbol sets you can overlay onto your holdings/underlyings universe in the Terminal.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/terminal"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Back to Terminal
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div className="grid gap-1">
            <div className="text-sm font-semibold text-zinc-700 dark:text-zinc-300">Create watchlist</div>
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                placeholder="e.g. Earnings week"
                className="h-9 w-64 rounded-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
              />
              <button
                type="button"
                onClick={() => {
                  const name = newName.trim();
                  if (!name) return;
                  void (async () => {
                    setError(null);
                    try {
                      await fetch("/api/watchlists", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({ name }),
                      });
                      setNewName("");
                      await refreshCb();
                    } catch (e) {
                      setError(e instanceof Error ? e.message : String(e));
                    }
                  })();
                }}
                className="h-9 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-900 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
              >
                Create
              </button>
            </div>
          </div>
          <button
            type="button"
            onClick={() => void refreshCb()}
            className="h-9 rounded-lg border border-zinc-300 bg-white px-3 text-sm font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Refresh
          </button>
        </div>

        <div className="mt-5 grid gap-4 lg:grid-cols-[320px_1fr]">
          <div className="rounded-xl border border-zinc-300 p-3 dark:border-white/20">
            <div className="text-sm font-semibold">Lists</div>
            <div className="mt-2 grid gap-1">
              {watchlists.length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">No watchlists yet.</div>
              ) : null}
              {watchlists.map((w) => {
                const active = w.id === activeId;
                return (
                  <button
                    key={w.id}
                    type="button"
                    onClick={() => setActiveId(w.id)}
                    className={
                      "flex w-full items-center justify-between rounded-lg border px-2 py-2 text-left text-sm " +
                      (active
                        ? "border-zinc-950 bg-zinc-950 text-white dark:border-white dark:bg-white dark:text-black"
                        : "border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                    }
                  >
                    <span className="font-semibold">{w.name}</span>
                    <span className={"tabular-nums text-xs " + (active ? "text-white/90 dark:text-black/70" : "text-zinc-600 dark:text-zinc-400")}>
                      {w.itemCount}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="rounded-xl border border-zinc-300 p-3 dark:border-white/20">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="text-sm font-semibold">{active ? `Items: ${active.name}` : "Select a list"}</div>
              {active ? (
                <div className="flex flex-wrap items-center gap-2">
                  <input
                    value={newSym}
                    onChange={(e) => setNewSym(e.target.value)}
                    placeholder="Symbol (e.g. AAPL)"
                    className="h-9 w-56 rounded-lg border border-zinc-300 bg-white px-2 text-sm text-zinc-900 shadow-sm placeholder:text-zinc-400 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                  />
                  <button
                    type="button"
                    onClick={() => {
                      const symbol = normSym(newSym);
                      if (!activeId || !symbol) return;
                      void (async () => {
                        setError(null);
                        try {
                          await fetch("/api/watchlists/items", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ watchlistId: activeId, symbol, op: "add" }),
                          });
                          setNewSym("");
                          await loadItems(activeId);
                          await loadWatchlists();
                        } catch (e) {
                          setError(e instanceof Error ? e.message : String(e));
                        }
                      })();
                    }}
                    className="h-9 rounded-lg bg-zinc-950 px-3 text-sm font-semibold text-white hover:bg-zinc-900 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
                  >
                    Add
                  </button>
                </div>
              ) : null}
            </div>

            <div className="mt-3">
              {!active ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">Choose a watchlist to view and edit symbols.</div>
              ) : items.length === 0 ? (
                <div className="text-sm text-zinc-600 dark:text-zinc-400">No symbols yet.</div>
              ) : (
                <div className="grid gap-1">
                  {items.map((it) => (
                    <div
                      key={it.symbol}
                      className="flex items-center justify-between rounded-lg border border-zinc-300 bg-white/70 px-2 py-2 text-sm dark:border-white/20 dark:bg-zinc-950"
                    >
                      <SymbolLink symbol={it.symbol} className="font-semibold">
                        {it.symbol}
                      </SymbolLink>
                      <button
                        type="button"
                        onClick={() => {
                          if (!activeId) return;
                          void (async () => {
                            setError(null);
                            try {
                              await fetch("/api/watchlists/items", {
                                method: "POST",
                                headers: { "Content-Type": "application/json" },
                                body: JSON.stringify({ watchlistId: activeId, symbol: it.symbol, op: "remove" }),
                              });
                              await loadItems(activeId);
                              await loadWatchlists();
                            } catch (e) {
                              setError(e instanceof Error ? e.message : String(e));
                            }
                          })();
                        }}
                        className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
                      >
                        Remove
                      </button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </section>
    </div>
  );
}

