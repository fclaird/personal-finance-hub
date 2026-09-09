"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

import { SituationHeadingTotals, SituationLifecycle } from "@/app/components/strategy/SituationLifecycle";
import { formatUsd2 } from "@/lib/format";
import { clumpPartialFills } from "@/lib/situations/clumpPartialFills";
import { pnlTone } from "@/lib/situations/situationPnlTone";
import { situationHeadingFigures } from "@/lib/situations/situationTree";
import { situationKindMatchesTab, type SituationView } from "@/lib/situations/apiTypes";

type KindFilter = "all" | "short-strangles" | "butterflies";
type StatusFilter = "all" | "open" | "closed";

export type SituationCounts = { open: number; closed: number };

export function SituationsPanel({
  privacyMasked,
  kindFilter = "all",
  hideChrome = false,
  hideList = false,
  forcedStatus,
  onCounts,
  onRows,
  onPropose,
}: {
  privacyMasked: boolean;
  kindFilter?: KindFilter;
  hideChrome?: boolean;
  /** When true, still loads/rebuilds situations but does not render the card list (live books own the UI). */
  hideList?: boolean;
  forcedStatus?: StatusFilter;
  onCounts?: (counts: SituationCounts) => void;
  onRows?: (rows: SituationView[]) => void;
  onPropose?: (fn: () => Promise<void>) => void;
}) {
  const [rows, setRows] = useState<SituationView[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [proposing, setProposing] = useState(false);
  const [updatingLinks, setUpdatingLinks] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [userCollapsed, setUserCollapsed] = useState<Set<string>>(new Set());
  const [userExpanded, setUserExpanded] = useState<Set<string>>(new Set());
  const [statusFilterState, setStatusFilter] = useState<StatusFilter>("all");
  const didAutoPropose = useRef(false);
  const lastLoadRebuilt = useRef<boolean | null>(null);
  const statusFilter = forcedStatus ?? statusFilterState;

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/option-situations", { cache: "no-store" });
      const json = (await resp.json()) as {
        ok: boolean;
        situations?: SituationView[];
        rebuilt?: boolean;
        error?: string;
      };
      if (!json.ok) throw new Error(json.error ?? "Failed to load situations");
      lastLoadRebuilt.current = Boolean(json.rebuilt);
      setRows(json.situations ?? []);
      if (json.rebuilt) {
        setUpdatingLinks(true);
        window.setTimeout(() => setUpdatingLinks(false), 2500);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setRows([]);
      lastLoadRebuilt.current = null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    onPropose?.(() => propose());
  }, [onPropose, proposing]);

  // Backup: if GET ensure returned empty without rebuilding (edge), force POST once.
  useEffect(() => {
    if (loading || proposing || error) return;
    if (rows.length > 0 || didAutoPropose.current) return;
    if (lastLoadRebuilt.current === true) return;
    didAutoPropose.current = true;
    void propose();
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one-shot when the book is empty after first load
  }, [loading, rows.length]);

  const eligible = useMemo(() => {
    return rows.filter((r) => {
      if (r.linkStatus === "rejected") return false;
      if (kindFilter !== "all" && !situationKindMatchesTab(r.kind, kindFilter)) return false;
      return true;
    });
  }, [rows, kindFilter]);

  useEffect(() => {
    onCounts?.({
      open: eligible.filter((r) => r.status === "open").length,
      closed: eligible.filter((r) => r.status === "closed").length,
    });
    onRows?.(eligible);
  }, [eligible, onCounts, onRows]);

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

  function isExpanded(r: SituationView): boolean {
    if (userCollapsed.has(r.id)) return false;
    if (userExpanded.has(r.id)) return true;
    return r.status === "open";
  }

  function toggle(r: SituationView) {
    const open = isExpanded(r);
    if (open) {
      setUserCollapsed((prev) => new Set(prev).add(r.id));
      setUserExpanded((prev) => {
        const next = new Set(prev);
        next.delete(r.id);
        return next;
      });
    } else {
      setUserExpanded((prev) => new Set(prev).add(r.id));
      setUserCollapsed((prev) => {
        const next = new Set(prev);
        next.delete(r.id);
        return next;
      });
    }
  }

  const filtered = eligible.filter((r) => (statusFilter === "all" ? true : r.status === statusFilter));

  const pending = filtered.filter((r) => r.linkStatus === "auto" || r.linkStatus === "proposed").length;
  const net = filtered.reduce((s, r) => s + (r.netPremium ?? 0), 0);
  const netAny = filtered.some((r) => r.netPremium != null);
  const openCount = eligible.filter((r) => r.status === "open").length;
  const closedCount = eligible.filter((r) => r.status === "closed").length;

  return (
    <div className="flex flex-col gap-4">
      {hideChrome ? null : (
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Situation book</h2>
            <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-300">
              One card per linked book. Open situations expand to the lifecycle (open → rolls / adjusts → close) with
              running net premium. Confirm auto-links; reject splits a pair so it is not re-proposed.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => {
                window.location.assign("/api/option-situations?format=csv");
              }}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
            >
              CSV
            </button>
            <button
              type="button"
              onClick={() => void propose()}
              disabled={proposing}
              className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
            >
              {proposing ? "Linking…" : "Force re-link"}
            </button>
          </div>
        </div>
      )}

      {updatingLinks ? (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">Updating links…</p>
      ) : null}

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
                {s === "open" ? ` ${openCount}` : s === "closed" ? ` ${closedCount}` : ""}
              </button>
            ))}
        {pending > 0 ? (
          <span className="text-zinc-600 dark:text-zinc-300">{pending} unconfirmed</span>
        ) : null}
        {netAny ? (
          <span className={"ml-auto font-medium tabular-nums " + pnlTone(net, { realized: statusFilter === "closed" })}>
            Book net {formatUsd2(net, { mask: privacyMasked })}
          </span>
        ) : null}
      </div>

      {error ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}

      {hideList ? (
        !loading && rows.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-4 text-center text-sm text-zinc-600 dark:border-white/20 dark:text-zinc-300">
            {proposing || updatingLinks ? "Building trade history from Schwab fills…" : "No linked situations yet."}
          </div>
        ) : null
      ) : (
      <div className="flex flex-col gap-3">
        {filtered.map((r) => {
          const expanded = isExpanded(r);
          const heading = situationHeadingFigures(clumpPartialFills(r.members), { status: r.status });
          return (
            <article
              key={r.id}
              className="rounded-xl border border-zinc-300 bg-white shadow-sm dark:border-white/20 dark:bg-zinc-950"
            >
              <div className="flex flex-wrap items-center gap-3 px-3 py-2.5">
                <button type="button" onClick={() => toggle(r)} className="min-w-0 flex-1 text-left">
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.title}</div>
                  <div className="text-xs text-zinc-600 dark:text-zinc-300">
                    {r.accountName}
                    {" · "}
                    {expanded ? "Hide lifecycle" : "Show lifecycle"}
                  </div>
                </button>
                <span className="rounded-full bg-zinc-100 px-2 py-0.5 text-[11px] capitalize text-zinc-700 dark:bg-white/10 dark:text-zinc-200">
                  {r.kind.replace(/-/g, " ")}
                </span>
                <span
                  className={
                    "rounded-full px-2 py-0.5 text-[11px] capitalize " +
                    (r.status === "open"
                      ? "bg-sky-100 text-sky-900 dark:bg-sky-950/50 dark:text-sky-100"
                      : "bg-zinc-100 text-zinc-600 dark:bg-white/10 dark:text-zinc-300")
                  }
                >
                  {r.status}
                </span>
                <span className="tabular-nums text-xs text-zinc-600 dark:text-zinc-300">{r.openedOn}</span>
                <SituationHeadingTotals
                  openCredit={heading.openCredit}
                  realized={heading.realized}
                  privacyMasked={privacyMasked}
                />
                <span className="text-xs text-zinc-600 dark:text-zinc-300">{r.members.length} fills</span>
                <span className="flex flex-wrap gap-1">
                  {r.linkStatus === "confirmed" || r.linkStatus === "rejected" ? (
                    <span className="text-xs capitalize text-zinc-600 dark:text-zinc-300">{r.linkStatus}</span>
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
              {expanded ? <SituationLifecycle row={r} privacyMasked={privacyMasked} /> : null}
            </article>
          );
        })}
        {!loading && filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-zinc-300 p-6 text-center text-sm text-zinc-600 dark:border-white/20 dark:text-zinc-300">
            No situations in this filter. Sync TRADE history, then refresh links.
          </div>
        ) : null}
      </div>
      )}
    </div>
  );
}
