"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

import {
  GroupedTable,
  computeUnderlyingGroups,
  type Row,
  type SortColumn,
  type ViewMode,
} from "@/app/components/PositionsGroupedTable";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { useSchwabRefreshCoordinator } from "@/hooks/useSchwabRefreshCoordinator";
import { bucketFromDisplayName } from "@/lib/accountBuckets";

export default function PositionsPage() {
  const privacy = usePrivacy();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>("symbol");
  const [sortAsc, setSortAsc] = useState(true);
  const [nick, setNick] = useState<Map<string, string | null>>(new Map());
  const [savingNick, setSavingNick] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("perAccount");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [underPx, setUnderPx] = useState<Map<string, number>>(new Map());

  async function load() {
    const resp = await fetch("/api/positions");
    const json = (await resp.json()) as { ok: boolean; positions?: Row[]; error?: string };
    if (!json.ok) throw new Error(json.error ?? "Failed to load positions");
    setRows(json.positions ?? []);
  }

  async function loadUnderlyingPrices(rs: Row[]) {
    // Needed to compute synthetic MV for option-only underlyings.
    const syms = Array.from(
      new Set(
        rs
          .map((r) =>
            (r.securityType === "option" ? r.effectiveUnderlyingSymbol ?? r.underlyingSymbol : r.symbol) ?? "",
          )
          .map((s) => (s ?? "").trim().toUpperCase())
          .filter(Boolean),
      ),
    );
    if (syms.length === 0) {
      setUnderPx(new Map());
      return;
    }
    const resp = await fetch("/api/quotes", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ symbols: syms }),
    });
    const json = (await resp.json().catch(() => null)) as
      | { ok: boolean; quotes?: Array<{ symbol: string; last: number | null; mark?: number | null; close: number | null }> }
      | null;
    if (!json?.ok) return;
    const m = new Map<string, number>();
    for (const q of json.quotes ?? []) {
      const s = (q.symbol ?? "").toUpperCase();
      const px = (q.last ?? q.mark ?? q.close) as number | null;
      if (s && px != null && Number.isFinite(px) && px > 0) m.set(s, px);
    }
    setUnderPx(m);
  }

  async function loadNicknames() {
    const resp = await fetch("/api/accounts", { cache: "no-store" });
    const json = (await resp.json()) as {
      ok: boolean;
      accounts?: Array<{ id: string; nickname: string | null }>;
      error?: string;
    };
    if (!json.ok) throw new Error(json.error ?? "Failed to load accounts");
    const m = new Map<string, string | null>();
    for (const a of json.accounts ?? []) m.set(a.id, a.nickname ?? null);
    setNick(m);
  }

  useEffect(() => {
    (async () => {
      await load();
      await loadNicknames();
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, []);

  useSchwabRefreshCoordinator({
    onTick: () => load().catch((e) => setError(e instanceof Error ? e.message : String(e))),
  });

  useEffect(() => {
    const t = setTimeout(() => {
      void loadUnderlyingPrices(rows).catch(() => null);
    }, 0);
    return () => clearTimeout(t);
  }, [rows]);

  const grouped = useMemo(() => {
    const byAccount = new Map<string, { accountName: string; accountType: string | null; rows: Row[] }>();
    for (const r of rows) {
      if (!byAccount.has(r.accountId)) {
        byAccount.set(r.accountId, {
          accountName: r.accountName ?? r.accountId,
          accountType: r.accountType ?? null,
          rows: [],
        });
      }
      byAccount.get(r.accountId)!.rows.push(r);
    }

    type Group = { accountId: string; accountName: string; accountType: string | null; rows: Row[] };
    const all: Group[] = Array.from(byAccount.entries()).map(([accountId, v]) => ({
      accountId,
      accountName: v.accountName,
      accountType: v.accountType,
      rows: v.rows,
    }));

    const joint: Group[] = [];
    const brokerage: Group[] = [];
    const retirement: Group[] = [];

    for (const g of all) {
      const nickname = (nick.get(g.accountId) ?? "").trim();
      const displayName = (nickname || g.accountName || g.accountId).trim();
      const isJoint = /\bjoint\b/i.test(nickname);
      if (isJoint) {
        joint.push(g);
        continue;
      }
      const bucket = isRetirementAccountType(g.accountType) ? "retirement" : bucketFromDisplayName(displayName);
      if (bucket === "retirement") retirement.push(g);
      else brokerage.push(g);
    }

    function displaySort(a: Group, b: Group) {
      const an = ((nick.get(a.accountId) ?? "").trim() || a.accountName).toLowerCase();
      const bn = ((nick.get(b.accountId) ?? "").trim() || b.accountName).toLowerCase();
      return an.localeCompare(bn);
    }

    joint.sort(displaySort);
    brokerage.sort(displaySort);
    retirement.sort(displaySort);

    return { joint, brokerage, retirement };
  }, [rows, nick]);

  function isRetirementAccountType(accountType: string | null | undefined): boolean {
    const s = (accountType ?? "").trim().toLowerCase();
    if (!s) return false;
    return /(ira|roth|401k|sep|retire|pension)/i.test(s);
  }

  const allGroups = useMemo(() => computeUnderlyingGroups(rows, sortColumn, sortAsc, underPx), [rows, sortColumn, sortAsc, underPx]);

  function toggleSort(col: SortColumn) {
    if (sortColumn === col) setSortAsc((v) => !v);
    else {
      setSortColumn(col);
      setSortAsc(true);
    }
  }

  function collapseKey(accountId: string, underlying: string) {
    return `${viewMode}:${accountId}:${underlying}`;
  }

  function toggleCollapsed(accountId: string, underlying: string) {
    const k = collapseKey(accountId, underlying);
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function renderAccount(acct: { accountId: string; accountName: string; rows: Row[] }) {
    const rs = acct.rows;
    const groups = computeUnderlyingGroups(rs, sortColumn, sortAsc, underPx);
    return (
      <details
        key={acct.accountId}
        open
        className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950"
      >
        <summary className="cursor-pointer list-none">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="min-w-0">
              <h2 className="text-base font-semibold">{nick.get(acct.accountId) ? nick.get(acct.accountId) : acct.accountName}</h2>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <span className="font-mono">{acct.accountId}</span>
                <span aria-hidden="true">•</span>
                <label className="flex items-center gap-2">
                  <span className="font-medium">Nickname</span>
                  <input
                    defaultValue={nick.get(acct.accountId) ?? ""}
                    placeholder="(optional)"
                    className="h-8 w-56 rounded-md border border-zinc-300 bg-white px-2 text-xs text-zinc-900 shadow-sm placeholder:text-zinc-400 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500"
                    onKeyDown={(e) => {
                      if (e.key !== "Enter") return;
                      const v = (e.currentTarget.value ?? "").trim();
                      void (async () => {
                        setSavingNick(acct.accountId);
                        try {
                          await fetch("/api/accounts/nickname", {
                            method: "POST",
                            headers: { "Content-Type": "application/json" },
                            body: JSON.stringify({ accountId: acct.accountId, nickname: v }),
                          });
                          await loadNicknames();
                        } finally {
                          setSavingNick(null);
                        }
                      })();
                    }}
                  />
                </label>
                {savingNick === acct.accountId ? <span className="text-zinc-500">Saving…</span> : null}
              </div>
            </div>
            <div className="text-sm text-zinc-600 dark:text-zinc-400">
              {rs.length} position{rs.length === 1 ? "" : "s"} • {groups.length} underlying
            </div>
          </div>
        </summary>
        <GroupedTable
          accountId={acct.accountId}
          viewMode={viewMode}
          groups={groups}
          showAccountCol={false}
          nick={nick}
          sortColumn={sortColumn}
          sortAsc={sortAsc}
          toggleSort={toggleSort}
          collapsed={collapsed}
          toggleCollapsed={toggleCollapsed}
          privacyMasked={privacy.masked}
        />
      </details>
    );
  }

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Positions</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Individual holdings and option positions from the latest snapshot.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/connections"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Connections
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="text-sm font-medium text-zinc-700 dark:text-zinc-300">View</div>
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={() => setViewMode("perAccount")}
            className={
              "rounded-full px-4 py-2 text-sm font-medium " +
              (viewMode === "perAccount"
                ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                : "border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
            }
          >
            Per account
          </button>
          <button
            type="button"
            onClick={() => setViewMode("allAccounts")}
            className={
              "rounded-full px-4 py-2 text-sm font-medium " +
              (viewMode === "allAccounts"
                ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                : "border border-zinc-300 bg-white text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
            }
          >
            All accounts
          </button>
        </div>
      </div>

      <div className="grid gap-4">
        {viewMode === "allAccounts" ? (
          <details
            open
            className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950"
          >
            <summary className="cursor-pointer list-none">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="min-w-0">
                  <h2 className="text-base font-semibold">All accounts</h2>
                  <div className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
                    {rows.length} position{rows.length === 1 ? "" : "s"} • {allGroups.length} underlying
                  </div>
                </div>
              </div>
            </summary>
            <GroupedTable
              accountId="all"
              viewMode={viewMode}
              groups={allGroups}
              showAccountCol={true}
              nick={nick}
              sortColumn={sortColumn}
              sortAsc={sortAsc}
              toggleSort={toggleSort}
              collapsed={collapsed}
              toggleCollapsed={toggleCollapsed}
              privacyMasked={privacy.masked}
            />
          </details>
        ) : (
          <>
            {grouped.joint.map((acct) => renderAccount(acct))}

            {grouped.brokerage.length ? (
              <div className="rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-2 text-xs font-semibold tracking-wide text-zinc-700 dark:border-white/20 dark:bg-white/5 dark:text-zinc-200">
                Brokerage
              </div>
            ) : null}

            {grouped.brokerage.map((acct) => renderAccount(acct))}

            {grouped.retirement.length ? (
              <div className="rounded-xl border border-zinc-300 bg-zinc-50 px-4 py-2 text-xs font-semibold tracking-wide text-zinc-700 dark:border-white/20 dark:bg-white/5 dark:text-zinc-200">
                Retirement
              </div>
            ) : null}

            {grouped.retirement.map((acct) => renderAccount(acct))}
          </>
        )}

        {grouped.joint.length + grouped.brokerage.length + grouped.retirement.length === 0 ? (
          <div className="text-sm text-zinc-600 dark:text-zinc-400">
            No positions yet. Run Schwab sync on Connections.
          </div>
        ) : null}
      </div>
    </div>
  );
}
