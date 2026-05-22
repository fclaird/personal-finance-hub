"use client";

import type { ReactNode, ThHTMLAttributes } from "react";

/** Cursor + grab affordance for draggable table headers */
export const DRAGGABLE_COLUMN_HEADER_GRAB_CLASS = "cursor-grab select-none active:cursor-grabbing";

export function DraggableColumnHeader<T extends string>({
  colId,
  columnOrder,
  moveColumn,
  className,
  scope = "col",
  "aria-sort": ariaSort,
  children,
}: {
  colId: T;
  columnOrder: T[];
  moveColumn: (from: number, to: number) => void;
  className?: string;
  scope?: ThHTMLAttributes<HTMLTableHeaderCellElement>["scope"];
  "aria-sort"?: ThHTMLAttributes<HTMLTableHeaderCellElement>["aria-sort"];
  children: ReactNode;
}) {
  return (
    <th
      scope={scope}
      aria-sort={ariaSort}
      draggable
      onDragStart={(e) => {
        e.dataTransfer.setData("text/plain", colId);
        e.dataTransfer.effectAllowed = "move";
      }}
      onDragOver={(e) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
      }}
      onDrop={(e) => {
        e.preventDefault();
        const fromId = e.dataTransfer.getData("text/plain") as T;
        if (!fromId || columnOrder.indexOf(fromId) < 0) return;
        const from = columnOrder.indexOf(fromId);
        const to = columnOrder.indexOf(colId);
        if (from >= 0 && to >= 0) moveColumn(from, to);
      }}
      className={className}
      title="Drag column header to reorder"
    >
      {children}
    </th>
  );
}
