"use client";

import { useMemo } from "react";

import { DraggableColumnHeader, DRAGGABLE_COLUMN_HEADER_GRAB_CLASS } from "@/app/components/DraggableColumnHeader";
import { SymbolLink } from "@/app/components/SymbolLink";
import type { Row } from "@/app/components/PositionsGroupedTable";
import { symbolPageEquityRowMark } from "@/lib/analytics/symbolPageExposure";
import { formatInt, formatNum, formatOptionIntExtPerShare, formatUsd2 } from "@/lib/format";
import { formatOptionSymbolDisplay } from "@/lib/formatOptionDisplay";
import type { QuoteLike } from "@/lib/market/equityMarkPrice";
import {
  POSITIONS_COLUMN_LABEL,
  type PositionsColumnId,
} from "@/lib/positions/positionsColumnOrder";
import { usePositionsColumnOrder } from "@/lib/positions/usePositionsColumnOrder";
import { symbolPageTargetFromInstrument } from "@/lib/symbolPage";
import { posNegClass } from "@/lib/terminal/colors";

const SYMBOL_POSITIONS_COLUMNS: readonly PositionsColumnId[] = [
  "account",
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
  "syntheticShares",
];

function usd2Masked(v: number, masked: boolean) {
  return formatUsd2(v, { mask: masked });
}

function usd2Unmasked(v: number) {
  return formatUsd2(v, { mask: false });
}

function syntheticSharesForRow(r: Row): number | null {
  if (r.securityType !== "option") return null;
  const d = typeof r.delta === "number" && Number.isFinite(r.delta) ? r.delta : 0;
  return r.quantity * 100 * d;
}

export function SymbolPositionsTable({
  rows,
  quote,
  privacyMasked,
}: {
  rows: Row[];
  quote: QuoteLike | null;
  privacyMasked: boolean;
}) {
  const { order: columnOrder, moveColumn } = usePositionsColumnOrder(SYMBOL_POSITIONS_COLUMNS);
  const grab = " " + DRAGGABLE_COLUMN_HEADER_GRAB_CLASS;

  const sortedRows = useMemo(() => {
    const list = [...rows];
    list.sort((a, b) => {
      const am = Math.abs(a.marketValue ?? 0);
      const bm = Math.abs(b.marketValue ?? 0);
      if (bm !== am) return bm - am;
      const as = a.securityType === "option" ? formatOptionSymbolDisplay(a) : a.symbol;
      const bs = b.securityType === "option" ? formatOptionSymbolDisplay(b) : b.symbol;
      return as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
    });
    return list;
  }, [rows]);

  function headerCell(colId: PositionsColumnId) {
    const align = colId === "account" || colId === "symbol" ? "text-left" : "text-right";
    return (
      <DraggableColumnHeader
        key={colId}
        colId={colId}
        columnOrder={columnOrder}
        moveColumn={moveColumn}
        className={`py-1 pr-4 font-medium ${align}${grab}`}
      >
        {POSITIONS_COLUMN_LABEL[colId]}
      </DraggableColumnHeader>
    );
  }

  function dataCell(colId: PositionsColumnId, r: Row, rowMark: { price: number | null; marketValue: number | null }) {
    const synth = syntheticSharesForRow(r);
    switch (colId) {
      case "account":
        return (
          <td key={colId} className="whitespace-nowrap py-1 pr-4 text-left text-xs text-zinc-600 dark:text-zinc-400">
            {r.accountName}
          </td>
        );
      case "symbol":
        return (
          <td key={colId} className="whitespace-nowrap py-1 pr-4 text-left font-medium">
            <SymbolLink symbol={symbolPageTargetFromInstrument(r)} className="font-mono text-[13px]">
              {r.securityType === "option" ? (
                <span className={r.quantity < 0 ? "text-red-400" : "text-emerald-400"}>
                  {formatOptionSymbolDisplay(r)}
                </span>
              ) : (
                <span>{r.symbol}</span>
              )}
            </SymbolLink>
          </td>
        );
      case "quantity":
        return (
          <td key={colId} className={"whitespace-nowrap py-1 pr-4 text-right " + posNegClass(r.quantity)}>
            {formatInt(r.quantity)}
          </td>
        );
      case "price":
        return (
          <td key={colId} className="whitespace-nowrap py-1 pr-4 text-right">
            {rowMark.price == null ? "—" : usd2Unmasked(rowMark.price)}
          </td>
        );
      case "marketValue":
        return (
          <td
            key={colId}
            className={
              "whitespace-nowrap py-1 pr-4 text-right " +
              (rowMark.marketValue == null ? "" : posNegClass(rowMark.marketValue))
            }
          >
            {rowMark.marketValue == null ? "—" : usd2Masked(rowMark.marketValue, privacyMasked)}
          </td>
        );
      case "delta":
        return (
          <td key={colId} className={"whitespace-nowrap py-1 pr-4 text-right " + posNegClass(r.delta)}>
            {r.delta == null ? "—" : formatNum(r.delta, 3)}
          </td>
        );
      case "gamma":
        return (
          <td key={colId} className={"whitespace-nowrap py-1 pr-4 text-right " + posNegClass(r.gamma)}>
            {r.gamma == null ? "—" : formatNum(r.gamma, 4)}
          </td>
        );
      case "theta":
        return (
          <td key={colId} className={"whitespace-nowrap py-1 pr-4 text-right " + posNegClass(r.theta)}>
            {r.theta == null ? "—" : formatNum(r.theta, 3)}
          </td>
        );
      case "dte":
        return (
          <td key={colId} className="whitespace-nowrap py-1 pr-4 text-right">
            {r.dte == null ? "—" : formatInt(r.dte)}
          </td>
        );
      case "intrinsic":
        return (
          <td key={colId} className="whitespace-nowrap py-1 pr-4 text-right text-zinc-800 dark:text-zinc-200">
            {formatOptionIntExtPerShare(r.intrinsic, r.quantity, { mask: privacyMasked })}
          </td>
        );
      case "extrinsic":
        return (
          <td key={colId} className="whitespace-nowrap py-1 pr-4 text-right text-zinc-800 dark:text-zinc-200">
            {formatOptionIntExtPerShare(r.extrinsic, r.quantity, { mask: privacyMasked })}
          </td>
        );
      case "syntheticShares":
        return (
          <td key={colId} className={"whitespace-nowrap py-1 text-right font-semibold " + posNegClass(synth)}>
            {synth == null ? "—" : synth.toFixed(2)}
          </td>
        );
      default:
        return null;
    }
  }

  if (sortedRows.length === 0) {
    return <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">No positions found.</div>;
  }

  return (
    <div className="mt-2 overflow-x-auto">
      <table className="min-w-[72rem] w-full text-sm">
        <thead className="text-xs text-zinc-600 dark:text-zinc-400">
          <tr>{columnOrder.map((colId) => headerCell(colId))}</tr>
        </thead>
        <tbody className="tabular-nums text-zinc-900 dark:text-zinc-100">
          {sortedRows.map((r) => {
            const rowMark = symbolPageEquityRowMark(r, quote);
            return (
              <tr key={r.positionId} className="border-t border-zinc-200/70 dark:border-white/10">
                {columnOrder.map((colId) => dataCell(colId, r, rowMark))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
