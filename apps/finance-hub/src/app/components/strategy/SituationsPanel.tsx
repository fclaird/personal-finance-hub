"use client";

import { Fragment, useCallback, useEffect, useState } from "react";

import { formatUsd2 } from "@/lib/format";
import { posNegClass } from "@/lib/terminal/colors";
import type { SituationLinkStatus, SituationMemberRole } from "@/lib/situations/types";

type Member = {
  transactionId: string;
  role: SituationMemberRole;
  tradeDate: string;
  symbol: string | null;
  netAmount: number | null;
  instruction: string | null;
  description: string | null;
};

type SituationRow = {
  id: string;
  accountId: string;
  accountName: string;
  underlying: string;
  kind: string;
  status: string;
  linkStatus: SituationLinkStatus;
  openedOn: string;
  closedOn: string | null;
  netPremium: number | null;
  title: string;
  members: Member[];
};

function kindLabel(kind: string): string {
  return kind.replace(/-/g, " ");
}

function roleLabel(role: SituationMemberRole): string {
  switch (role) {
    case "open":
      return "Open";
    case "roll_close":
      return "Roll close";
    case "roll_open":
      return "Roll open";
    case "close":
      return "Close";
    default:
      return "Leg";
  }
}

export function SituationsPanel({ privacyMasked }: { privacyMasked: boolean }) {
  const [rows, setRows] = useState<SituationRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [proposing, setProposing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch("/api/option-situations", { cache: "no-store" });
      const json = (await resp.json()) as { ok: boolean; situations?: SituationRow[]; error?: string };
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
      const json = (await resp.json()) as { ok: boolean; situations?: SituationRow[]; error?: string };
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

  const pending = rows.filter((r) => r.linkStatus === "auto" || r.linkStatus === "proposed").length;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">Situations</h2>
          <p className="mt-1 text-sm text-zinc-600 dark:text-zinc-400">
            Linked multi-leg / roll / short-premium books with net cash. Auto-links are confirmable; rejected pairs are
            not re-proposed.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void load()}
            disabled={loading}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            {loading ? "Loading…" : "Refresh"}
          </button>
          <a
            href="/api/option-situations?format=csv"
            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Export CSV
          </a>
          <button
            type="button"
            onClick={() => void propose()}
            disabled={proposing}
            className="rounded-full border border-zinc-300 bg-white px-3 py-1.5 text-xs font-semibold text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            {proposing ? "Linking…" : "Propose / refresh links"}
          </button>
        </div>
      </div>

      {pending > 0 ? (
        <p className="text-sm text-zinc-600 dark:text-zinc-400">
          {pending} auto or proposed situation{pending === 1 ? "" : "s"} awaiting confirm or reject.
        </p>
      ) : null}

      {error ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}

      <div className="overflow-x-auto rounded-xl border border-zinc-300 bg-white shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <table className="min-w-full text-sm">
          <thead>
            <tr className="bg-zinc-50 dark:bg-black/30">
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Situation</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Kind</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Status</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Link</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Opened</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Net premium</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Legs</th>
              <th className="px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:text-zinc-400">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <Fragment key={r.id}>
                <tr className="border-t border-zinc-100 dark:border-white/10">
                  <td className="px-3 py-2">
                    <button type="button" onClick={() => toggle(r.id)} className="text-left hover:underline">
                      <div className="font-medium text-zinc-900 dark:text-zinc-100">{r.title}</div>
                      <div className="text-xs text-zinc-500 dark:text-zinc-400">{r.accountName}</div>
                    </button>
                  </td>
                  <td className="px-3 py-2 capitalize text-zinc-700 dark:text-zinc-300">{kindLabel(r.kind)}</td>
                  <td className="px-3 py-2 capitalize text-zinc-700 dark:text-zinc-300">{r.status}</td>
                  <td className="px-3 py-2 capitalize text-zinc-700 dark:text-zinc-300">{r.linkStatus}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-700 dark:text-zinc-300">{r.openedOn}</td>
                  <td
                    className={
                      "px-3 py-2 tabular-nums font-medium " +
                      (r.netPremium == null ? "text-zinc-500" : posNegClass(r.netPremium) || "text-zinc-800 dark:text-zinc-200")
                    }
                  >
                    {r.netPremium == null ? "—" : formatUsd2(r.netPremium, { mask: privacyMasked })}
                  </td>
                  <td className="px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-400">{r.members.length}</td>
                  <td className="px-3 py-2">
                    {r.linkStatus === "confirmed" || r.linkStatus === "rejected" ? (
                      <span className="text-xs text-zinc-500">{r.linkStatus}</span>
                    ) : (
                      <div className="flex flex-wrap gap-1">
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void setLink(r.id, "confirmed")}
                          className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5"
                        >
                          Confirm
                        </button>
                        <button
                          type="button"
                          disabled={busyId === r.id}
                          onClick={() => void setLink(r.id, "rejected")}
                          className="rounded-full border border-zinc-300 px-2 py-0.5 text-xs font-semibold hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:hover:bg-white/5"
                        >
                          Reject
                        </button>
                      </div>
                    )}
                  </td>
                </tr>
                {expanded.has(r.id)
                  ? r.members.map((m) => (
                      <tr key={`${r.id}:${m.transactionId}`} className="bg-zinc-50/80 dark:bg-white/5">
                        <td className="px-3 py-1 pl-8 font-mono text-xs text-zinc-600 dark:text-zinc-400" colSpan={2}>
                          {m.symbol ?? m.transactionId}
                        </td>
                        <td className="px-3 py-1 text-xs text-zinc-600 dark:text-zinc-400">{roleLabel(m.role)}</td>
                        <td className="px-3 py-1 text-xs text-zinc-600 dark:text-zinc-400">{m.instruction ?? "—"}</td>
                        <td className="px-3 py-1 text-xs tabular-nums text-zinc-600 dark:text-zinc-400">{m.tradeDate}</td>
                        <td
                          className={
                            "px-3 py-1 text-xs tabular-nums " +
                            (m.netAmount == null ? "text-zinc-500" : posNegClass(m.netAmount) || "")
                          }
                        >
                          {m.netAmount == null ? "—" : formatUsd2(m.netAmount, { mask: privacyMasked })}
                        </td>
                        <td className="px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400" colSpan={2}>
                          {m.description ?? ""}
                        </td>
                      </tr>
                    ))
                  : null}
              </Fragment>
            ))}
          </tbody>
        </table>
        {!loading && rows.length === 0 ? (
          <div className="p-6 text-center text-sm text-zinc-600 dark:text-zinc-400">
            No situations yet. Sync transaction history, then propose links.
          </div>
        ) : null}
      </div>
    </div>
  );
}
