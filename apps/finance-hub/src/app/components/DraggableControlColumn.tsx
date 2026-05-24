"use client";

import { useCallback, type ReactNode } from "react";

import { usePersistedCollapsedSet, usePersistedOrder } from "@/lib/usePersistedOrder";

/**
 * Vertical stack of control groups with a draggable title bar to reorder.
 * Click the title to collapse/expand. Order and collapse persist in localStorage.
 */
export function DraggableControlColumn({
  storageKey,
  defaultOrder,
  titles,
  renderBlock,
  className,
}: {
  storageKey: string;
  defaultOrder: readonly string[];
  titles: Record<string, string>;
  renderBlock: (id: string) => ReactNode;
  className?: string;
}) {
  const { order, reorderById } = usePersistedOrder(storageKey, defaultOrder);
  const { isCollapsed, toggleCollapsed } = usePersistedCollapsedSet(storageKey);

  const onDragStart = useCallback((e: React.DragEvent, id: string) => {
    e.dataTransfer.setData("text/plain", id);
    e.dataTransfer.effectAllowed = "move";
  }, []);

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback(
    (e: React.DragEvent, targetId: string) => {
      e.preventDefault();
      const sourceId = e.dataTransfer.getData("text/plain");
      if (!sourceId || sourceId === targetId) return;
      reorderById(sourceId, targetId);
    },
    [reorderById],
  );

  return (
    <div className={className ?? "flex w-full flex-col gap-3"}>
      {order.map((id) => {
        const collapsed = isCollapsed(id);
        return (
          <div
            key={id}
            className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/80 shadow-sm dark:border-white/15 dark:bg-zinc-900/40"
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, id)}
          >
            <div
              className={
                "flex items-stretch " + (collapsed ? "" : "border-b border-zinc-200 dark:border-white/10")
              }
            >
              <div
                draggable
                onDragStart={(e) => onDragStart(e, id)}
                className="flex shrink-0 cursor-grab items-center px-2 py-2 active:cursor-grabbing"
                title="Drag to reorder"
                aria-label={`Drag to reorder ${titles[id] ?? id}`}
              >
                <span className="text-sm leading-none text-zinc-400 dark:text-zinc-500" aria-hidden>
                  ⠿
                </span>
              </div>
              <button
                type="button"
                onClick={() => toggleCollapsed(id)}
                className="flex min-w-0 flex-1 items-center gap-2 px-1 py-2 text-left hover:bg-zinc-100/80 dark:hover:bg-white/5"
                aria-expanded={!collapsed}
                title={collapsed ? "Expand controls" : "Collapse controls"}
              >
                <span className="w-3 shrink-0 text-center text-[10px] text-zinc-500 dark:text-zinc-400" aria-hidden>
                  {collapsed ? "▸" : "▾"}
                </span>
                <span className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
                  {titles[id] ?? id}
                </span>
              </button>
            </div>
            {!collapsed ? <div className="p-2.5">{renderBlock(id)}</div> : null}
          </div>
        );
      })}
    </div>
  );
}
