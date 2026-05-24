"use client";

import Link from "next/link";
import { useEffect, useMemo, useState, type ReactNode } from "react";

import { DraggableTileLayout } from "@/app/components/DraggableTileLayout";
import {
  AddManualAccountDialog,
  ManualPositionDialog,
  type ManualPositionFormState,
} from "@/app/components/ManualAccountDialogs";
import {
  GroupedTable,
  computeUnderlyingGroups,
  type Row,
  type SortColumn,
  type ViewMode,
} from "@/app/components/PositionsGroupedTable";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { useSchwabRefreshCoordinator } from "@/hooks/useSchwabRefreshCoordinator";
import { bucketFromAccount, type AccountBucket } from "@/lib/accountBuckets";
import { isManualAccountId } from "@/lib/manual/isManualAccountId";

export default function PositionsPage() {
  const privacy = usePrivacy();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>("symbol");
  const [sortAsc, setSortAsc] = useState(true);
  const [nick, setNick] = useState<Map<string, string | null>>(new Map());
  const [manualAccounts, setManualAccounts] = useState<
    Array<{ accountId: string; accountName: string; accountBucket: AccountBucket }>
  >([]);
  const [savingNick, setSavingNick] = useState<string | null>(null);
  const [viewMode, setViewMode] = useState<ViewMode>("perAccount");
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [underPx, setUnderPx] = useState<Map<string, number>>(new Map());
  const [addAccountOpen, setAddAccountOpen] = useState(false);
  const [positionDialog, setPositionDialog] = useState<ManualPositionFormState | null>(null);

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
      accounts?: Array<{ id: string; nickname: string | null; name: string; accountBucket: string | null }>;
      error?: string;
    };
    if (!json.ok) throw new Error(json.error ?? "Failed to load accounts");
    const m = new Map<string, string | null>();
    const manual: Array<{ accountId: string; accountName: string; accountBucket: AccountBucket }> = [];
    for (const a of json.accounts ?? []) {
      m.set(a.id, a.nickname ?? null);
      if (isManualAccountId(a.id)) {
        const bucket = (a.accountBucket ?? "brokerage") as AccountBucket;
        manual.push({ accountId: a.id, accountName: a.name, accountBucket: bucket });
      }
    }
    setNick(m);
    setManualAccounts(manual);
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
    const byAccount = new Map<string, { accountName: string; accountType: string | null; accountBucket: AccountBucket | null; rows: Row[] }>();
    for (const r of rows) {
      if (!byAccount.has(r.accountId)) {
        byAccount.set(r.accountId, {
          accountName: r.accountName ?? r.accountId,
          accountType: r.accountType ?? null,
          accountBucket: (r.accountBucket as AccountBucket | null) ?? null,
          rows: [],
        });
      }
      byAccount.get(r.accountId)!.rows.push(r);
    }

    for (const ma of manualAccounts) {
      if (!byAccount.has(ma.accountId)) {
        byAccount.set(ma.accountId, {
          accountName: ma.accountName,
          accountType: "manual",
          accountBucket: ma.accountBucket,
          rows: [],
        });
      }
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
    const plan529: Group[] = [];

    for (const g of all) {
      const meta = byAccount.get(g.accountId);
      const nickname = (nick.get(g.accountId) ?? "").trim();
      const displayName = (nickname || g.accountName || g.accountId).trim();
      const isJoint = /\bjoint\b/i.test(nickname);
      if (isJoint) {
        joint.push(g);
        continue;
      }
      const bucket = bucketFromAccount(g.accountName, nick.get(g.accountId) ?? null, meta?.accountBucket);
      if (bucket === "529") plan529.push(g);
      else if (bucket === "retirement" || isRetirementAccountType(g.accountType)) retirement.push(g);
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
    plan529.sort(displaySort);

    return { joint, brokerage, retirement, plan529 };
  }, [rows, nick, manualAccounts]);

  function isRetirementAccountType(accountType: string | null | undefined): boolean {
    const s = (accountType ?? "").trim().toLowerCase();
    if (!s) return false;
    return /(ira|roth|401k|sep|retire|pension)/i.test(s);
  }

  const allGroups = useMemo(() => computeUnderlyingGroups(rows, sortColumn, sortAsc, underPx), [rows, sortColumn, sortAsc, underPx]);

  const showManualColumns = useMemo(
    () => rows.some((r) => r.isManual) || manualAccounts.length > 0,
    [rows, manualAccounts],
  );

  const positionsTileOrder = useMemo(() => {
    if (viewMode === "allAccounts") return ["all-accounts"] as const;
    return [
      ...grouped.joint.map((a) => `acct-${a.accountId}`),
      ...grouped.brokerage.map((a) => `acct-${a.accountId}`),
      ...grouped.retirement.map((a) => `acct-${a.accountId}`),
      ...grouped.plan529.map((a) => `acct-${a.accountId}`),
    ];
  }, [viewMode, grouped]);

  async function deleteManualPosition(row: Row) {
    if (!confirm(`Remove ${row.symbol} from this external account?`)) return;
    await fetch(`/api/manual/positions/${encodeURIComponent(row.positionId)}`, { method: "DELETE" });
    await load();
  }

  function openAddHolding(accountId: string) {
    setPositionDialog({
      accountId,
      symbol: "",
      securityType: "equity",
      quantity: "",
      purchasePrice: "",
      marketValue: "",
      purchaseDate: "",
      notes: "",
    });
  }

  function openEditHolding(row: Row) {
    setPositionDialog({
      positionId: row.positionId,
      accountId: row.accountId,
      symbol: row.symbol,
      securityType: row.securityType === "cash" ? "cash" : row.securityType === "fund" ? "fund" : "equity",
      quantity: String(row.quantity),
      purchasePrice: row.price == null ? "" : String(row.price),
      marketValue: row.marketValue == null ? "" : String(row.marketValue),
      purchaseDate: row.purchaseDate ?? "",
      notes: "",
    });
  }

  const positionsTiles = useMemo(() => {
    if (viewMode === "allAccounts") {
      return {
        "all-accounts": {
          title: "All accounts",
          children: (
            <>
              <div className="mb-4 text-xs text-zinc-600 dark:text-zinc-400">
                {rows.length} position{rows.length === 1 ? "" : "s"} • {allGroups.length} underlying
              </div>
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
                showManualColumns={showManualColumns}
                onEditManualPosition={openEditHolding}
                onDeleteManualPosition={(r) => void deleteManualPosition(r)}
              />
            </>
          ),
        },
      };
    }

    const tiles: Record<string, { title: string; children: ReactNode }> = {};
    const addAccount = (
      acct: { accountId: string; accountName: string; rows: Row[] },
      bucket: "joint" | "brokerage" | "retirement" | "529",
    ) => {
      const rs = acct.rows;
      const groups = computeUnderlyingGroups(rs, sortColumn, sortAsc, underPx);
      const displayName = (nick.get(acct.accountId) ?? "").trim() || acct.accountName;
      const isManual = isManualAccountId(acct.accountId);
      const prefix =
        bucket === "joint"
          ? ""
          : bucket === "brokerage"
            ? "Brokerage · "
            : bucket === "retirement"
              ? "Retirement · "
              : "529 · ";
      tiles[`acct-${acct.accountId}`] = {
        title: `${prefix}${displayName}${isManual ? " (external)" : ""}`,
        children: (
          <>
            <div className="mb-4 flex flex-wrap items-center gap-2 text-xs text-zinc-600 dark:text-zinc-400">
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
              {isManual ? (
                <>
                  <span aria-hidden="true">•</span>
                  <button
                    type="button"
                    onClick={() => openAddHolding(acct.accountId)}
                    className="rounded-md border border-zinc-300 bg-white px-2 py-1 text-xs font-medium hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:hover:bg-white/5"
                  >
                    Add holding
                  </button>
                </>
              ) : null}
              <span aria-hidden="true">•</span>
              <span>
                {rs.length} position{rs.length === 1 ? "" : "s"} • {groups.length} underlying
              </span>
            </div>
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
              showManualColumns={showManualColumns}
              onEditManualPosition={isManual ? openEditHolding : undefined}
              onDeleteManualPosition={isManual ? (r) => void deleteManualPosition(r) : undefined}
            />
            {isManual && rs.length === 0 ? (
              <p className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">
                No holdings yet. Click <span className="font-medium">Add holding</span> above to enter your first position.
              </p>
            ) : null}
          </>
        ),
      };
    };

    for (const acct of grouped.joint) addAccount(acct, "joint");
    for (const acct of grouped.brokerage) addAccount(acct, "brokerage");
    for (const acct of grouped.retirement) addAccount(acct, "retirement");
    for (const acct of grouped.plan529) addAccount(acct, "529");
    return tiles;
  }, [
    viewMode,
    grouped,
    rows.length,
    allGroups,
    nick,
    sortColumn,
    sortAsc,
    collapsed,
    privacy.masked,
    underPx,
    savingNick,
    showManualColumns,
    manualAccounts.length,
  ]);

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

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Positions</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Individual holdings from Schwab sync and manually entered external accounts.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setAddAccountOpen(true)}
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Add external account
          </button>
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

      {grouped.joint.length + grouped.brokerage.length + grouped.retirement.length + grouped.plan529.length === 0 ? (
        <div className="text-sm text-zinc-600 dark:text-zinc-400">
          No positions yet. Connect Schwab on Connections or add an external account.
        </div>
      ) : (
        <DraggableTileLayout
          storageKey="fh.positions.tiles.v1"
          defaultOrder={positionsTileOrder}
          tiles={positionsTiles}
        />
      )}

      <AddManualAccountDialog
        open={addAccountOpen}
        onClose={() => setAddAccountOpen(false)}
        onSaved={(account) => {
          void loadNicknames().catch((e) => setError(e instanceof Error ? e.message : String(e)));
          void load().catch((e) => setError(e instanceof Error ? e.message : String(e)));
          openAddHolding(account.id);
        }}
      />
      <ManualPositionDialog
        open={positionDialog != null}
        initial={positionDialog}
        onClose={() => setPositionDialog(null)}
        onSaved={() => void load().catch((e) => setError(e instanceof Error ? e.message : String(e)))}
      />
    </div>
  );
}
