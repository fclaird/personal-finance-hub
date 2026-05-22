"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import {
  GroupedTable,
  computeUnderlyingGroups,
  type Row,
  type SortColumn,
  type ViewMode,
} from "@/app/components/PositionsGroupedTable";
import { usePrivacy } from "@/app/components/PrivacyProvider";

export function AccountPositionsForAllocation({ accountId }: { accountId: string }) {
  const privacy = usePrivacy();
  const [rows, setRows] = useState<Row[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [sortColumn, setSortColumn] = useState<SortColumn>("symbol");
  const [sortAsc, setSortAsc] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [underPx, setUnderPx] = useState<Map<string, number>>(new Map());
  const viewMode: ViewMode = "perAccount";
  const nick = useMemo(() => new Map<string, string | null>(), []);

  const loadUnderlyingPrices = useCallback(async (rs: Row[]) => {
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
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      setError(null);
      try {
        const resp = await fetch(`/api/positions?accountId=${encodeURIComponent(accountId)}`, {
          cache: "no-store",
        });
        const json = (await resp.json()) as { ok: boolean; positions?: Row[]; error?: string };
        if (!resp.ok || !json.ok) {
          setRows([]);
          setError(json.error ?? "Could not load positions for this account.");
          return;
        }
        const list = json.positions ?? [];
        setRows(list);

        if (!cancelled) void loadUnderlyingPrices(list).catch(() => null);
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
        setRows([]);
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountId, loadUnderlyingPrices]);

  const groups = useMemo(
    () => computeUnderlyingGroups(rows, sortColumn, sortAsc, underPx),
    [rows, sortColumn, sortAsc, underPx],
  );

  function toggleSort(col: SortColumn) {
    if (sortColumn === col) setSortAsc((v) => !v);
    else {
      setSortColumn(col);
      setSortAsc(true);
    }
  }

  function toggleCollapsed(acctId: string, underlying: string) {
    const k = `${viewMode}:${acctId}:${underlying}`;
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  return (
    <div className="mt-4 border-t border-zinc-200 pt-4 dark:border-white/15">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
        Positions
      </div>
      {loading ? (
        <div className="text-sm text-zinc-600 dark:text-zinc-400">Loading positions…</div>
      ) : error ? (
        <div className="rounded-lg bg-amber-50 p-2 text-sm text-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
          {error}
        </div>
      ) : rows.length === 0 ? (
        <div className="text-sm text-zinc-600 dark:text-zinc-400">No positions in the latest snapshot for this account.</div>
      ) : (
        <GroupedTable
          accountId={accountId}
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
      )}
    </div>
  );
}
