"use client";

import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";

function parseOrder(raw: string | null, allowed: readonly string[]): string[] | null {
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return null;
    const set = new Set(allowed);
    const out = parsed.filter((x): x is string => typeof x === "string" && set.has(x));
    if (out.length !== allowed.length) return null;
    const seen = new Set<string>();
    for (const id of out) {
      if (seen.has(id)) return null;
      seen.add(id);
    }
    return out;
  } catch {
    return null;
  }
}

/**
 * Vertical stack of control groups with a draggable title bar to reorder.
 * Order is persisted in `localStorage` under `storageKey`.
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
  const allowed = useMemo(() => [...defaultOrder], [defaultOrder]);
  const [order, setOrder] = useState<string[]>(() => {
    if (typeof window === "undefined") return [...allowed];
    const stored = parseOrder(window.localStorage.getItem(storageKey), allowed);
    return stored ?? [...allowed];
  });

  useEffect(() => {
    try {
      window.localStorage.setItem(storageKey, JSON.stringify(order));
    } catch {
      /* ignore quota */
    }
  }, [storageKey, order]);

  const onDragStart = useCallback(
    (e: React.DragEvent, id: string) => {
      e.dataTransfer.setData("text/plain", id);
      e.dataTransfer.effectAllowed = "move";
    },
    [],
  );

  const onDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
  }, []);

  const onDrop = useCallback((e: React.DragEvent, targetId: string) => {
    e.preventDefault();
    const sourceId = e.dataTransfer.getData("text/plain");
    if (!sourceId || sourceId === targetId) return;
    setOrder((prev) => {
      const i = prev.indexOf(sourceId);
      const j = prev.indexOf(targetId);
      if (i < 0 || j < 0) return prev;
      const next = [...prev];
      next.splice(i, 1);
      next.splice(j, 0, sourceId);
      return next;
    });
  }, []);

  return (
    <div className={className ?? "flex w-full flex-col gap-3"}>
      {order.map((id) => (
        <div
          key={id}
          className="overflow-hidden rounded-xl border border-zinc-200 bg-zinc-50/80 shadow-sm dark:border-white/15 dark:bg-zinc-900/40"
          onDragOver={onDragOver}
          onDrop={(e) => onDrop(e, id)}
        >
          <div
            draggable
            onDragStart={(e) => onDragStart(e, id)}
            className="flex cursor-grab select-none items-center gap-2 border-b border-zinc-200 bg-white px-2.5 py-2 active:cursor-grabbing dark:border-white/15 dark:bg-zinc-950"
            title="Drag to reorder"
          >
            <span className="text-sm leading-none text-zinc-400 dark:text-zinc-500" aria-hidden>
              ⠿
            </span>
            <span className="text-xs font-semibold uppercase tracking-wide text-zinc-600 dark:text-zinc-400">
              {titles[id] ?? id}
            </span>
          </div>
          <div className="bg-white p-2.5 dark:bg-zinc-950">{renderBlock(id)}</div>
        </div>
      ))}
    </div>
  );
}
