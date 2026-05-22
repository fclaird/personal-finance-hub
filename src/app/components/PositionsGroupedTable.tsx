"use client";

import { Fragment } from "react";
import { DraggableColumnHeader, DRAGGABLE_COLUMN_HEADER_GRAB_CLASS } from "@/app/components/DraggableColumnHeader";
import { SymbolLink } from "@/app/components/SymbolLink";
import { formatInt, formatNum, formatOptionIntExtPerShare, formatUsd2 } from "@/lib/format";
import { formatOptionSymbolDisplay } from "@/lib/formatOptionDisplay";
import { symbolPageTargetFromInstrument } from "@/lib/symbolPage";
import { usePersistedColumnOrder } from "@/lib/usePersistedColumnOrder";
import { posNegClass } from "@/lib/terminal/colors";

export type Row = {
  positionId: string;
  asOf: string;
  accountId: string;
  accountName: string;
  accountType: string;
  symbol: string;
  securityName: string;
  securityType: string;
  underlyingSymbol: string | null;
  effectiveUnderlyingSymbol?: string | null;
  optionExpiration: string | null;
  optionRight: "C" | "P" | null;
  optionStrike: number | null;
  quantity: number;
  price: number | null;
  marketValue: number | null;
  delta: number | null;
  gamma: number | null;
  theta: number | null;
  dte: number | null;
  intrinsic: number | null;
  extrinsic: number | null;
};

function usd2Masked(v: number, masked: boolean) {
  return formatUsd2(v, { mask: masked });
}

function usd2Unmasked(v: number) {
  return formatUsd2(v, { mask: false });
}

function n0(v: number | null | undefined) {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function formatOptionSymbol(r: Row) {
  return formatOptionSymbolDisplay(r);
}

export type SortColumn =
  | "symbol"
  | "quantity"
  | "price"
  | "marketValue"
  | "delta"
  | "gamma"
  | "theta"
  | "dte"
  | "intrinsic"
  | "extrinsic";

/** Includes optional Account column (per-account view). */
export type PositionsTableColumnId = "account" | SortColumn;

const POSITIONS_COL_ORDER_NO_ACCOUNT: readonly SortColumn[] = [
  "symbol",
  "quantity",
  "price",
  "marketValue",
  "delta",
  "gamma",
  "theta",
  "dte",
  "intrinsic",
  "extrinsic",
];

const POSITIONS_COL_ORDER_WITH_ACCOUNT: readonly PositionsTableColumnId[] = [
  "account",
  ...POSITIONS_COL_ORDER_NO_ACCOUNT,
];

const SORT_COLUMN_LABEL: Record<SortColumn, string> = {
  symbol: "Symbol",
  quantity: "Qty",
  price: "Price",
  marketValue: "Market\u00A0value",
  delta: "Delta",
  gamma: "Gamma",
  theta: "Theta",
  dte: "DTE",
  intrinsic: "Intrinsic",
  extrinsic: "Extrinsic",
};

const POSITIONS_TH_STICKY =
  "sticky top-0 z-20 whitespace-nowrap border-b border-zinc-300 bg-zinc-50 py-2 pr-6 font-medium dark:border-white/20 dark:bg-zinc-950 ";

function symbolSortKey(r: Row) {
  return r.securityType === "option" ? formatOptionSymbol(r) : r.symbol;
}

function compareNullableNumber(a: number | null, b: number | null, asc: boolean): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  const cmp = a - b;
  return asc ? cmp : -cmp;
}

function compareRows(a: Row, b: Row, col: SortColumn, asc: boolean): number {
  switch (col) {
    case "symbol":
      return symbolSortKey(a).localeCompare(symbolSortKey(b), undefined, { numeric: true, sensitivity: "base" }) * (asc ? 1 : -1);
    case "quantity": {
      const cmp = a.quantity - b.quantity;
      return asc ? cmp : -cmp;
    }
    case "price":
      return compareNullableNumber(a.price, b.price, asc);
    case "marketValue":
      return compareNullableNumber(a.marketValue, b.marketValue, asc);
    case "delta":
      return compareNullableNumber(a.delta, b.delta, asc);
    case "gamma":
      return compareNullableNumber(a.gamma, b.gamma, asc);
    case "theta":
      return compareNullableNumber(a.theta, b.theta, asc);
    case "dte":
      return compareNullableNumber(a.dte, b.dte, asc);
    case "intrinsic":
      return compareNullableNumber(a.intrinsic, b.intrinsic, asc);
    case "extrinsic":
      return compareNullableNumber(a.extrinsic, b.extrinsic, asc);
    default:
      return 0;
  }
}

function sortPositionRows(rows: Row[], col: SortColumn, asc: boolean): Row[] {
  return [...rows].sort((a, b) => {
    const primary = compareRows(a, b, col, asc);
    if (primary !== 0) return primary;
    return a.positionId.localeCompare(b.positionId);
  });
}

export type ViewMode = "perAccount" | "allAccounts";

export type UnderlyingGroup = {
  underlying: string;
  rows: Row[];
  spotMarketValue: number;
  syntheticMarketValue: number;
  netMarketValue: number;
};

export function GroupedTable({
  accountId,
  viewMode,
  groups,
  showAccountCol,
  nick,
  sortColumn,
  sortAsc,
  toggleSort,
  collapsed,
  toggleCollapsed,
  privacyMasked,
}: {
  accountId: string;
  viewMode: ViewMode;
  groups: UnderlyingGroup[];
  showAccountCol: boolean;
  nick: Map<string, string | null>;
  sortColumn: SortColumn;
  sortAsc: boolean;
  toggleSort: (col: SortColumn) => void;
  collapsed: Set<string>;
  toggleCollapsed: (accountId: string, underlying: string) => void;
  privacyMasked: boolean;
}) {
  function isCollapsed(underlying: string) {
    return collapsed.has(`${viewMode}:${accountId}:${underlying}`);
  }

  const columnStorageKey = showAccountCol ? "positions:grouped:v1:withAccount" : "positions:grouped:v1:noAccount";
  const columnDefaultOrder = showAccountCol ? POSITIONS_COL_ORDER_WITH_ACCOUNT : POSITIONS_COL_ORDER_NO_ACCOUNT;
  const { order: columnOrder, moveColumn } = usePersistedColumnOrder(columnStorageKey, columnDefaultOrder);

  const grab = " " + DRAGGABLE_COLUMN_HEADER_GRAB_CLASS;

  function headerCell(colId: PositionsTableColumnId) {
    if (colId === "account") {
      return (
        <DraggableColumnHeader
          key={colId}
          colId={colId}
          columnOrder={columnOrder}
          moveColumn={moveColumn}
          className={POSITIONS_TH_STICKY + "text-left text-zinc-600 dark:text-zinc-400" + grab}
        >
          Account
        </DraggableColumnHeader>
      );
    }
    const col = colId as SortColumn;
    const align = col === "symbol" ? "left" : "right";
    const thAlign = align === "right" ? "text-right" : "text-left";
    const active = sortColumn === col;
    return (
      <DraggableColumnHeader
        key={colId}
        colId={colId}
        columnOrder={columnOrder}
        moveColumn={moveColumn}
        className={POSITIONS_TH_STICKY + thAlign + grab}
        aria-sort={active ? (sortAsc ? "ascending" : "descending") : "none"}
      >
        <SortThButton
          col={col}
          label={SORT_COLUMN_LABEL[col]}
          sortColumn={sortColumn}
          sortAsc={sortAsc}
          onToggle={toggleSort}
          align={align}
        />
      </DraggableColumnHeader>
    );
  }

  function groupEmDashTd(colId: PositionsTableColumnId) {
    return (
      <td key={colId} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums text-zinc-500 dark:text-zinc-400">
        —
      </td>
    );
  }

  function groupRowCell(colId: PositionsTableColumnId, g: UnderlyingGroup, collapsedNow: boolean) {
    const caret = collapsedNow ? "▸" : "▾";
    switch (colId) {
      case "account":
        return <td key={colId} className="whitespace-nowrap py-2 pr-6 text-xs text-zinc-600 dark:text-zinc-400" />;
      case "symbol":
        return (
          <td key={colId} className="whitespace-nowrap py-2 pr-6 font-semibold">
            <span className="inline-flex items-center gap-2">
              <span className="w-4 text-zinc-500 dark:text-zinc-400">{caret}</span>
              <SymbolLink symbol={g.underlying} className="font-semibold text-zinc-900 dark:text-zinc-100">
                {g.underlying}
              </SymbolLink>
            </span>
          </td>
        );
      case "quantity":
      case "price":
        return groupEmDashTd(colId);
      case "marketValue":
        return (
          <td
            key={colId}
            className={
              "whitespace-nowrap py-2 pr-6 text-right tabular-nums font-semibold " + posNegClass(g.netMarketValue)
            }
          >
            {usd2Masked(g.netMarketValue, privacyMasked)}
          </td>
        );
      case "delta":
      case "gamma":
      case "theta":
      case "dte":
      case "intrinsic":
      case "extrinsic":
        return groupEmDashTd(colId);
      default:
        return null;
    }
  }

  function dataRowCell(colId: PositionsTableColumnId, r: Row) {
    switch (colId) {
      case "account":
        return (
          <td key={colId} className="whitespace-nowrap py-2 pr-6 text-xs text-zinc-600 dark:text-zinc-400">
            {nick.get(r.accountId) ?? r.accountName}
          </td>
        );
      case "symbol":
        return (
          <td key={colId} className="whitespace-nowrap py-2 pr-6 font-medium">
            <SymbolLink symbol={symbolPageTargetFromInstrument(r)} className="inline-block pl-6">
              {r.securityType === "option" ? (
                <span className={r.quantity < 0 ? "text-red-400" : "text-emerald-400"}>{formatOptionSymbol(r)}</span>
              ) : (
                <span>{r.symbol}</span>
              )}
            </SymbolLink>
          </td>
        );
      case "quantity":
        return (
          <td key={colId} className={"whitespace-nowrap py-2 pr-6 text-right tabular-nums " + posNegClass(r.quantity)}>
            {formatInt(r.quantity)}
          </td>
        );
      case "price":
        return (
          <td key={colId} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums">
            {r.price == null ? "-" : usd2Unmasked(r.price)}
          </td>
        );
      case "marketValue":
        return (
          <td
            key={colId}
            className={
              "whitespace-nowrap py-2 pr-6 text-right tabular-nums " + (r.marketValue == null ? "" : posNegClass(r.marketValue))
            }
          >
            {r.marketValue == null ? "-" : usd2Masked(r.marketValue, privacyMasked)}
          </td>
        );
      case "delta":
        return (
          <td key={colId} className={"whitespace-nowrap py-2 pr-6 text-right tabular-nums " + posNegClass(r.delta)}>
            {r.delta == null ? "-" : formatNum(r.delta, 3)}
          </td>
        );
      case "gamma":
        return (
          <td key={colId} className={"whitespace-nowrap py-2 pr-6 text-right tabular-nums " + posNegClass(r.gamma)}>
            {r.gamma == null ? "-" : formatNum(r.gamma, 4)}
          </td>
        );
      case "theta":
        return (
          <td key={colId} className={"whitespace-nowrap py-2 pr-6 text-right tabular-nums " + posNegClass(r.theta)}>
            {r.theta == null ? "-" : formatNum(r.theta, 3)}
          </td>
        );
      case "dte":
        return (
          <td key={colId} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums">
            {r.dte == null ? "-" : formatInt(r.dte)}
          </td>
        );
      case "intrinsic":
        return (
          <td key={colId} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
            {formatOptionIntExtPerShare(r.intrinsic, r.quantity, { mask: privacyMasked })}
          </td>
        );
      case "extrinsic":
        return (
          <td key={colId} className="whitespace-nowrap py-2 pr-6 text-right tabular-nums text-zinc-800 dark:text-zinc-200">
            {formatOptionIntExtPerShare(r.extrinsic, r.quantity, { mask: privacyMasked })}
          </td>
        );
      default:
        return null;
    }
  }

  return (
    <div className="mt-4 max-w-full overflow-x-auto overflow-y-visible pb-2">
      <table className="w-max min-w-[1600px] border-collapse text-sm">
        <thead>
          <tr className="border-b border-zinc-300 text-zinc-600 dark:border-white/20 dark:text-zinc-400">
            {columnOrder.map((colId) => headerCell(colId))}
          </tr>
        </thead>
        <tbody>
          {groups.map((g) => {
            const collapsedNow = isCollapsed(g.underlying);
            return (
              <Fragment key={g.underlying}>
                <tr
                  className="cursor-pointer border-b border-zinc-200 bg-zinc-100/90 hover:bg-zinc-100 dark:border-white/10 dark:bg-white/15 dark:hover:bg-white/20"
                  onClick={() => toggleCollapsed(accountId, g.underlying)}
                  title="Toggle underlying group"
                >
                  {columnOrder.map((colId) => groupRowCell(colId, g, collapsedNow))}
                </tr>

                {collapsedNow
                  ? null
                  : g.rows.map((r) => (
                      <tr key={r.positionId} className="border-b border-zinc-200 dark:border-white/20">
                        {columnOrder.map((colId) => dataRowCell(colId, r))}
                      </tr>
                    ))}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function underlyingKey(r: Row): string {
  const sym = (r.symbol ?? "").trim();
  if (r.securityType === "option")
    return (r.effectiveUnderlyingSymbol ?? r.underlyingSymbol ?? sym).trim() || sym;
  return sym;
}

function groupSortValue(g: UnderlyingGroup, col: SortColumn): string | number {
  switch (col) {
    case "symbol":
      return g.underlying;
    case "marketValue":
      return g.netMarketValue;
    case "quantity":
      return g.rows.reduce((s, r) => s + n0(r.quantity), 0);
    case "price": {
      const qty = g.rows.filter((r) => r.securityType !== "option").reduce((s, r) => s + n0(r.quantity), 0);
      return qty ? g.spotMarketValue / qty : 0;
    }
    case "delta":
      return g.rows.filter((r) => r.securityType === "option").reduce((s, r) => s + n0(r.delta) * n0(r.quantity), 0);
    case "gamma":
      return g.rows.filter((r) => r.securityType === "option").reduce((s, r) => s + n0(r.gamma) * n0(r.quantity), 0);
    case "theta":
      return g.rows.filter((r) => r.securityType === "option").reduce((s, r) => s + n0(r.theta) * n0(r.quantity), 0);
    case "dte": {
      // Prefer soonest expiry in group (min DTE).
      const ds = g.rows.map((r) => r.dte).filter((v): v is number => typeof v === "number" && Number.isFinite(v));
      if (ds.length === 0) return Number.POSITIVE_INFINITY;
      return Math.min(...ds);
    }
    case "intrinsic":
      return g.rows.reduce((s, r) => s + n0(r.intrinsic), 0);
    case "extrinsic":
      return g.rows.reduce((s, r) => s + n0(r.extrinsic), 0);
    default:
      return 0;
  }
}

export function computeUnderlyingGroups(
  rs: Row[],
  sortColumn: SortColumn,
  sortAsc: boolean,
  underPx: Map<string, number>,
): UnderlyingGroup[] {
  const by = new Map<string, Row[]>();
  for (const r of rs) {
    const k = underlyingKey(r) || "UNKNOWN";
    if (!by.has(k)) by.set(k, []);
    by.get(k)!.push(r);
  }

  // Spot price approximation (needed to compute option synthetic MV).
  const spotPx = new Map<string, number>();
  for (const [u, rows] of by.entries()) {
    let qty = 0;
    let mv = 0;
    let bestPx: number | null = null;
    for (const r of rows) {
      if (r.securityType === "option") continue;
      const q = n0(r.quantity);
      const p = r.price;
      const m = r.marketValue;
      if (p != null && Number.isFinite(p) && p > 0) bestPx = p;
      qty += q;
      mv += n0(m);
    }
    const implied = qty !== 0 ? mv / qty : null;
    const px = bestPx ?? implied ?? underPx.get(u);
    if (px != null && Number.isFinite(px) && px > 0) spotPx.set(u, px);
  }

  const out: UnderlyingGroup[] = [];
  for (const [u, rows] of by.entries()) {
    const spotMv = rows
      .filter((r) => r.securityType !== "option")
      .reduce((s, r) => s + n0(r.marketValue), 0);

    const px = spotPx.get(u) ?? 0;
    const syntheticMv = rows
      .filter((r) => r.securityType === "option")
      .reduce((s, r) => s + n0(r.quantity) * 100 * n0(r.delta) * px, 0);

    // Prefer true net from summed position market values (spot + options).
    // Fall back to synthetic proxy if option market values are missing.
    const netFromMv = rows.reduce((s, r) => s + n0(r.marketValue), 0);
    const net = netFromMv !== 0 ? netFromMv : spotMv + syntheticMv;
    out.push({
      underlying: u,
      rows: sortPositionRows(rows, sortColumn, sortAsc),
      spotMarketValue: spotMv,
      syntheticMarketValue: syntheticMv,
      netMarketValue: net,
    });
  }

  out.sort((a, b) => {
    if (sortColumn === "symbol") {
      const cmp = a.underlying.localeCompare(b.underlying, undefined, { numeric: true, sensitivity: "base" });
      return sortAsc ? cmp : -cmp;
    }
    const av = groupSortValue(a, sortColumn);
    const bv = groupSortValue(b, sortColumn);
    const an = typeof av === "number" ? av : Number.NaN;
    const bn = typeof bv === "number" ? bv : Number.NaN;
    if (Number.isFinite(an) && Number.isFinite(bn)) {
      const cmp = an - bn;
      if (cmp !== 0) return sortAsc ? cmp : -cmp;
      // Stable fallback: net MV desc then symbol.
      return Math.abs(b.netMarketValue) - Math.abs(a.netMarketValue) || a.underlying.localeCompare(b.underlying);
    }
    const cmp = String(av).localeCompare(String(bv), undefined, { numeric: true, sensitivity: "base" });
    if (cmp !== 0) return sortAsc ? cmp : -cmp;
    return Math.abs(b.netMarketValue) - Math.abs(a.netMarketValue) || a.underlying.localeCompare(b.underlying);
  });
  return out;
}

function SortThButton({
  col,
  label,
  sortColumn,
  sortAsc,
  onToggle,
  align = "right",
}: {
  col: SortColumn;
  label: string;
  sortColumn: SortColumn;
  sortAsc: boolean;
  onToggle: (col: SortColumn) => void;
  align?: "left" | "right";
}) {
  const active = sortColumn === col;
  return (
    <button
      type="button"
      onClick={() => onToggle(col)}
      title={active ? `Sorted ${sortAsc ? "ascending" : "descending"}` : `Sort by ${label}`}
      className={
        "-mx-1 inline-flex w-full max-w-full items-center gap-1 rounded px-1 py-0.5 font-medium text-zinc-600 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/10 dark:hover:text-zinc-100 " +
        (align === "right" ? "justify-end" : "justify-start")
      }
    >
      <span>{label}</span>
      <span className="tabular-nums text-xs opacity-70" aria-hidden>
        {active ? (sortAsc ? "▲" : "▼") : ""}
      </span>
    </button>
  );
}
