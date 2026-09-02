"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { SituationLifecycle } from "@/app/components/strategy/SituationLifecycle";
import { formatUsd2 } from "@/lib/format";
import { posNegClass } from "@/lib/terminal/colors";
import { situationKindMatchesTab, type SituationView } from "@/lib/situations/apiTypes";

type KindFilter = "all" | "short-strangles" | "butterflies";
type StatusFilter = "all" | "open" | "closed";

export function SituationsPanel({
  privacyMasked,
  kindFilter = "all",
  hideChrome = false,
  forcedStatus,
}: {
  privacyMasked: boolean;
  kindFilter?: KindFilter;
  hideChrome?: boolean;
  forcedStatus?: StatusFilter;
}) {
  const [rows, setRows] = useState<SituationView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [proposing, setProposing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [statusFilterState, setStatusFilter] = useState<StatusFilter>("all");
  const statusFilter = forcedStatus ?? statusFilterState;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/option-situations", { cache: "no-store" });
      const json = (await resp.json()) as { ok: boolean; situations?: SituationView[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to load situations");
      setRows(json.situations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function propose() {
    setProposing(true);
    setError(null);
    try {
      const resp = await fetch("/api/option-situations", { method: "POST" });
      const json = (await resp.json()) as { ok: boolean; situations?: SituationView[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Propose failed");
      setRows(json.situations ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setProposing(false);
    }
  }

  async function setLink(id: string, linkStatus: "confirmed" | "rejected") {
    setBusyId(id);
    try {
      const resp = await fetch(`/api/option-situations/${encodeURIComponent(id)}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ linkStatus }),
      });
      const json = (await resp.json()) as { ok?: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Update failed");
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusyId(null);
    }
  }

  function toggle(id: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  const filtered = useMemo(() => {
    return rows.filter((r) => {
      if (r.linkStatus === "rejected") return false;
      if (kindFilter !== "all" && !situationKindMatchesTab(r.kind, kindFilter)) return false;
      if (statusFilter !== "all" && r.status !== statusFilter) return false;
      return true;
    });
  }, [rows, kindFilter, statusFilter]);

  const pending = filtered.filter((r) => r.linkStatus === "auto" || r.linkStatus === "proposed").length;
  const net = filtered.reduce((s, r) => s + (r.netPremium ?? 0), 0);
  const netAny = filtered.some((r) => r.netPremium != null);

  return (
    <div className="flex flex-col gap-4">
      {hideChrome ? null : (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Situation book</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
              One row per linked book: open → rolls / adjusts → close, with running net premium. Confirm auto-links;
              reject splits a pair so it is not re-proposed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <a
              href="/api/option-situations?format=csv"
              className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
            >
              CSV
            </a>
            <button
              type="button"
              onClick={() => void propose()}
              disabled={proposing}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
            >
              {proposing ? "Linking…" : "Refresh links"}
            </button>
          </div>
        </div>
      )}

      <div className="flex flex-wrap items-center gap-2 text-xs">
        {forcedStatus
          ? null
          : (["all", "open", "closed"] as const).map((s) => (
          <button
            key={s}
            type="button"
            onClick={() => setStatusFilter(s)}
            className={
              "rounded-full px-3 py-1 font-medium capitalize " +
              (statusFilter === s
                ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                : "border border-zinc-300 text-zinc-700 hover:bg-zinc-50 dark:border-white/20 dark:text-zinc-200 dark:hover:bg-white/5")
            }
          >
            {s}
          </button>
        ))}
        {pending > 0 ? (
          <span className="text-zinc-500 dark:text-zinc-400">{pending} unconfirmed</span>
        ) : null}
        {netAny ? (
          <span className={"ml-auto font-medium tabular-nums " + (posNegClass(net) || "text-zinc-700")}>
            Book net {formatUsd2(net, { mask: privacyMasked })}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-zinc-300 bg-white shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 dark:bg-black/30">
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Book</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Kind</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Status</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Opened</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Net</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Fills</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Link</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr key={r.id} className="border-t border-zinc-100 dark:border-white/10">
                <td colSpan={7} className="p-0">
                  <div className="flex flex-wrap items-center gap-3 px-3 py-2">
                    <button type="button" onClick={() => toggle(r.id)} className="min-w-0 flex-1 text-left hover:underline">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.title}</div>
                      <div className="text-xs text-zinc-500">{r.accountName}</div>
                    </button>
                    <span className="w-24 capitalize text-zinc-600 dark:text-zinc-300">{r.kind.replace(/-/g, " ")}</span>
                    <span className="w-16 capitalize text-zinc-600 dark:text-zinc-300">{r.status}</span>
                    <span className="w-24 tabular-nums text-zinc-600 dark:text-zinc-300">{r.openedOn}</span>
                    <span
                      className={
                        "w-24 tabular-nums font-medium " +
                        (r.netPremium == null ? "text-zinc-500" : posNegClass(r.netPremium) || "")
                      }
                    >
                      {r.netPremium == null ? "—" : formatUsd2(r.netPremium, { mask: privacyMasked })}
                    </span>
                    <span className="w-10 tabular-nums text-zinc-500">{r.members.length}</span>
                    <span className="flex w-36 flex-wrap gap-1">
                      {r.linkStatus === "confirmed" || r.linkStatus === "rejected" ? (
                        <span className="text-xs capitalize text-zinc-500">{r.linkStatus}</span>
                      ) : (
                        <>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void setLink(r.id, "confirmed")}
                            className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20"
                          >
                            Confirm
                          </button>
                          <button
                            type="button"
                            disabled={busyId === r.id}
                            onClick={() => void setLink(r.id, "rejected")}
                            className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20"
                          >
                            Reject
                          </button>
                        </>
                      )}
                    </span>
                  </div>
                  {expanded.has(r.id) ? <SituationLifecycle row={r} privacyMasked={privacyMasked} /> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {!loading && filtered.length === 0 ? (
          <div className="p-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
            No situations in this filter. Sync TRADE history, then refresh links.
          </div>
        ) : null}
      </div>
    </div>
  );
}
