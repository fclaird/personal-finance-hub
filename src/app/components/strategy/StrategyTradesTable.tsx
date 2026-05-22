"use client";

import { useMemo, useState } from "react";

import { SymbolLink } from "@/app/components/SymbolLink";
import { formatUsd2 } from "@/lib/format";
import { symbolPageTargetFromInstrument } from "@/lib/symbolPage";
import { posNegClass } from "@/lib/terminal/colors";
import { STRATEGY_TAB_META } from "@/lib/strategy/strategyCategories";
import type { StrategyTradeApiRow } from "@/lib/strategy/strategyTradeStats";

export type StrategySortCol =
  | "symbol"
  | "strategyCategory"
  | "entryDate"
  | "quantity"
  | "entryPrice"
  | "pnlDollars"
  | "pnlPct"
  | "accountName";

function strategyRowLabel(slug: string | null | undefined): string {
  if (slug == null || slug === "") return "—";
  const meta = STRATEGY_TAB_META.find((t) => t.slug === slug);
  if (meta) return meta.label;
  return slug.replace(/-/g, " ");
}

function compareRows(a: StrategyTradeApiRow, b: StrategyTradeApiRow, col: StrategySortCol, asc: boolean): number {
  const dir = asc ? 1 : -1;
  switch (col) {
    case "symbol":
      return ((a.symbol ?? "").localeCompare(b.symbol ?? "", undefined, { sensitivity: "base" }) || 0) * dir;
    case "strategyCategory":
      return (
        (strategyRowLabel(a.strategyCategory).localeCompare(strategyRowLabel(b.strategyCategory), undefined, {
          sensitivity: "base",
        }) || 0) * dir
      );
    case "entryDate":
      return (a.entryDate.localeCompare(b.entryDate) || 0) * dir;
    case "quantity": {
      const an = a.quantity ?? 0;
      const bn = b.quantity ?? 0;
      return (an - bn) * dir;
    }
    case "entryPrice": {
      const an = a.entryPrice ?? 0;
      const bn = b.entryPrice ?? 0;
      return (an - bn) * dir;
    }
    case "pnlDollars": {
      const an = a.pnlDollars ?? -Infinity;
      const bn = b.pnlDollars ?? -Infinity;
      return (an - bn) * dir;
    }
    case "pnlPct": {
      const an = a.pnlPct ?? -Infinity;
      const bn = b.pnlPct ?? -Infinity;
      return (an - bn) * dir;
    }
    case "accountName":
      return (a.accountName.localeCompare(b.accountName) || 0) * dir;
    default:
      return 0;
  }
}

export function StrategyTradesTable({
  rows,
  privacyMasked,
  showStrategyColumn = false,
}: {
  rows: StrategyTradeApiRow[];
  privacyMasked: boolean;
  showStrategyColumn?: boolean;
}) {
  const [sortCol, setSortCol] = useState<StrategySortCol>("entryDate");
  const [sortAsc, setSortAsc] = useState(false);

  const sorted = useMemo(() => {
    const copy = [...rows];
    copy.sort((a, b) => compareRows(a, b, sortCol, sortAsc));
    return copy;
  }, [rows, sortCol, sortAsc]);

  function toggle(col: StrategySortCol) {
    if (sortCol === col) setSortAsc((v) => !v);
    else {
      setSortCol(col);
      setSortAsc(true);
    }
  }

  function th(col: StrategySortCol, label: string) {
    return (
      <th className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-white/15 dark:text-zinc-400">
        <button type="button" onClick={() => toggle(col)} className="inline-flex items-center gap-1 hover:underline">
          {label}
          {sortCol === col ? (sortAsc ? " ↑" : " ↓") : ""}
        </button>
      </th>
    );
  }

  return (
    <div className="overflow-x-auto rounded-xl border border-zinc-300 bg-white shadow-sm dark:border-white/20 dark:bg-zinc-950">
      <table className="min-w-full text-sm">
        <thead>
          <tr className="bg-zinc-50 dark:bg-black/30">
            {th("symbol", "Symbol")}
            {showStrategyColumn ? th("strategyCategory", "Strategy") : null}
            {th("entryDate", "Entry date")}
            <th className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-white/15 dark:text-zinc-400">
              Exit date
            </th>
            {th("quantity", "Qty")}
            {th("entryPrice", "Entry px")}
            <th className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-white/15 dark:text-zinc-400">
              Exit / mark
            </th>
            {th("pnlDollars", "P&amp;L ($)")}
            {th("pnlPct", "P&amp;L (%)")}
            {th("accountName", "Account")}
            <th className="border-b border-zinc-200 px-3 py-2 text-left text-xs font-semibold text-zinc-600 dark:border-white/15 dark:text-zinc-400">
              Legs
            </th>
          </tr>
        </thead>
        <tbody>
          {sorted.map((r) => (
            <tr key={r.id} className="border-t border-zinc-100 dark:border-white/10">
              <td className="px-3 py-2 font-mono text-xs text-zinc-900 dark:text-zinc-100">
                <SymbolLink symbol={symbolPageTargetFromInstrument(r)} className="font-mono">
                  <span>
                    {r.symbol ?? r.underlyingSymbol ?? "—"}
                    {r.securityType === "option" && r.underlyingSymbol ? (
                      <span className="ml-1 text-zinc-500 dark:text-zinc-400">({r.underlyingSymbol})</span>
                    ) : null}
                  </span>
                </SymbolLink>
              </td>
              {showStrategyColumn ? (
                <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{strategyRowLabel(r.strategyCategory)}</td>
              ) : null}
              <td className="px-3 py-2 tabular-nums text-zinc-800 dark:text-zinc-200">{r.entryDate}</td>
              <td className="px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-400">{r.exitDate ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums text-zinc-800 dark:text-zinc-200">{r.quantity ?? "—"}</td>
              <td className="px-3 py-2 tabular-nums text-zinc-800 dark:text-zinc-200">
                {r.entryPrice == null ? "—" : formatUsd2(r.entryPrice, { mask: privacyMasked })}
              </td>
              <td className="px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-400">
                {r.exitOrCurrentPrice == null ? "—" : formatUsd2(r.exitOrCurrentPrice, { mask: privacyMasked })}
              </td>
              <td
                className={
                  "px-3 py-2 tabular-nums font-medium " +
                  (r.pnlDollars == null ? "text-zinc-500" : posNegClass(r.pnlDollars) || "text-zinc-800 dark:text-zinc-200")
                }
              >
                {r.pnlDollars == null ? "—" : formatUsd2(r.pnlDollars, { mask: privacyMasked })}
              </td>
              <td
                className={
                  "px-3 py-2 tabular-nums " +
                  (r.pnlPct == null ? "text-zinc-500" : posNegClass(r.pnlPct) || "text-zinc-800 dark:text-zinc-200")
                }
              >
                {r.pnlPct == null ? "—" : `${r.pnlPct.toFixed(2)}%`}
              </td>
              <td className="px-3 py-2 text-zinc-700 dark:text-zinc-300">{r.accountName}</td>
              <td className="px-3 py-2 tabular-nums text-zinc-600 dark:text-zinc-400">{r.legCount}</td>
            </tr>
          ))}
        </tbody>
      </table>
      {sorted.length === 0 ? (
        <div className="p-6 text-center text-sm text-zinc-600 dark:text-zinc-400">No trades to show.</div>
      ) : null}
    </div>
  );
}
