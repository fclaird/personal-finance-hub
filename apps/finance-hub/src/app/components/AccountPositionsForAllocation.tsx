"use client";

import { useEffect, useMemo, useState } from "react";

import {
  GroupedTable,
  computeUnderlyingGroups,
  type Row,
  type SortColumn,
  type ViewMode,
} from "@/app/components/PositionsGroupedTable";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { positionsForAccount } from "@/lib/client/positionsBook";
import { underPxMapFromNormalizedQuotes } from "@/lib/market/equityMarkPrice";

export function AccountPositionsForAllocation({
  accountId,
  rows,
}: {
  accountId: string;
  rows: readonly Row[];
}) {
  const privacy = usePrivacy();
  const [error, setError] = useState<string | null>(null);
  const [sortColumn, setSortColumn] = useState<SortColumn>("symbol");
  const [sortAsc, setSortAsc] = useState(true);
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const [underPx, setUnderPx] = useState<Map<string, number>>(new Map());
  const viewMode: ViewMode = "perAccount";
  const nick = useMemo(() => new Map<string, string | null>(), []);
  const accountRows = useMemo(() => positionsForAccount(rows, accountId), [rows, accountId]);

  useEffect(() => {
    let cancelled = false;
    const syms = Array.from(
      new Set(
        accountRows
          .map((r) =>
            (r.securityType === "option" ? r.effectiveUnderlyingSymbol ?? r.underlyingSymbol : r.symbol) ?? "",
          )
          .map((s) => (s ?? "").trim().toUpperCase())
          .filter(Boolean),
      ),
    );
    if (syms.length === 0) return;
    void (async () => {
      try {
        const resp = await fetch("/api/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: syms }),
        });
        const json = (await resp.json().catch(() => null)) as
          | { ok: boolean; quotes?: Array<{ symbol: string; last: number | null; mark?: number | null; close: number | null }> }
          | null;
        if (cancelled || !json?.ok) return;
        setUnderPx(underPxMapFromNormalizedQuotes(json.quotes ?? []));
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : String(e));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [accountRows]);

  const groups = useMemo(
    () => computeUnderlyingGroups(accountRows, sortColumn, sortAsc, underPx),
    [accountRows, sortColumn, sortAsc, underPx],
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
    <div className="mt-4 border-t border-zinc-400 pt-4">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-300">
        Positions
      </div>
      {error ? (
        <div className="rounded-lg border border-amber-700/60 bg-amber-950/40 p-2 text-sm text-amber-100">
          {error}
        </div>
      ) : accountRows.length === 0 ? (
        <div className="text-sm text-zinc-700 dark:text-zinc-300">No positions in the latest snapshot for this account.</div>
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
