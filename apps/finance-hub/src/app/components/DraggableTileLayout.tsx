"use client";

import { useCallback, useMemo, type ReactNode } from "react";
import { EditableHeading } from "@/app/components/EditableHeading";
import { usePersistedCollapsedSet, usePersistedOrder } from "@/lib/usePersistedOrder";

export type DraggableTileDef = {
  title: string;
  children: ReactNode;
  /** When false, tile is hidden and omitted from persisted order merge. */
  visible?: boolean;
  /** When false, tile body always stays open (default true). */
  collapsible?: boolean;
  /** Extra classes on the tile body wrapper (inside the card). */
  bodyClassName?: string;
};

const TILE_SHELL =
  "overflow-hidden rounded-2xl border border-zinc-300 bg-white shadow-sm dark:border-white/20 dark:bg-zinc-950";
const TILE_HEADER = "flex select-none items-stretch";
const TILE_HEADER_EXPANDED = "border-b border-zinc-200 dark:border-white/10";
const DRAG_HANDLE =
  "flex shrink-0 cursor-grab items-center px-2.5 py-2.5 text-zinc-400 active:cursor-grabbing dark:text-zinc-500";
const TITLE_BTN =
  "flex min-w-0 flex-1 items-center gap-2 px-1 py-2.5 text-left text-sm font-semibold text-zinc-700 hover:bg-zinc-100/80 dark:text-zinc-200 dark:hover:bg-white/5";

/**
 * Vertical stack of page tiles. Drag the ⠿ handle to reorder; click the title to collapse/expand.
 * Order and collapse state persist in localStorage.
 */
export function DraggableTileLayout({
  storageKey,
  defaultOrder,
  tiles,
  className,
  hint = "Drag ⠿ to reorder · click title to collapse · double-click title to rename",
}: {
  storageKey: string;
  defaultOrder: readonly string[];
  tiles: Record<string, DraggableTileDef>;
  className?: string;
  hint?: string | null;
}) {
  const visibleDefault = useMemo(
    () => defaultOrder.filter((id) => tiles[id]?.visible !== false),
    [defaultOrder, tiles],
  );
  const { order, reorderById } = usePersistedOrder(storageKey, visibleDefault);
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

  const rendered = order.filter((id) => tiles[id]?.visible !== false);

  return (
    <div className={className ?? "flex flex-col gap-6"}>
      {hint ? (
        <p className="text-xs text-zinc-600 dark:text-zinc-400">{hint}</p>
      ) : null}
      {rendered.map((id) => {
        const tile = tiles[id];
        if (!tile) return null;
        const collapsible = tile.collapsible !== false;
        const collapsed = collapsible && isCollapsed(id);
        return (
          <div
            key={id}
            className={TILE_SHELL}
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, id)}
          >
            <div className={TILE_HEADER + (collapsed ? "" : TILE_HEADER_EXPANDED)}>
              <div
                draggable
                onDragStart={(e) => onDragStart(e, id)}
                className={DRAG_HANDLE}
                title="Drag to reorder"
                aria-label={`Drag to reorder ${tile.title}`}
              >
                ⠿
              </div>
              {collapsible ? (
                <button
                  type="button"
                  onClick={() => toggleCollapsed(id)}
                  className={TITLE_BTN}
                  aria-expanded={!collapsed}
                  title={collapsed ? "Expand tile" : "Collapse tile"}
                >
                  <span className="w-4 shrink-0 text-center text-xs text-zinc-500 dark:text-zinc-400" aria-hidden>
                    {collapsed ? "▸" : "▾"}
                  </span>
                  <EditableHeading
                    namespace={storageKey}
                    id={id}
                    defaultLabel={tile.title}
                    className="min-w-0 truncate"
                  />
                </button>
              ) : (
                <div className={TITLE_BTN + " cursor-default hover:text-zinc-800 dark:hover:text-zinc-200"}>
                  <EditableHeading
                    namespace={storageKey}
                    id={id}
                    defaultLabel={tile.title}
                    className="min-w-0 truncate"
                  />
                </div>
              )}
            </div>
            {!collapsed ? (
              <div className={tile.bodyClassName ?? "p-4 sm:p-6"}>{tile.children}</div>
            ) : null}
          </div>
        );
      })}
    </div>
  );
}
