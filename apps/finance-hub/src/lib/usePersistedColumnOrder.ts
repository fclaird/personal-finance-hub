import { useEffect, useRef, useState } from "react";

/** Restore saved order; keep valid ids in order, append any new column ids from defaultOrder. */
function mergeWithDefaults<T extends string>(saved: unknown, defaultOrder: readonly T[]): T[] {
  const known = new Set(defaultOrder);
  const seen = new Set<T>();
  const out: T[] = [];
  if (Array.isArray(saved)) {
    for (const x of saved) {
      if (typeof x !== "string" || !known.has(x as T)) continue;
      const id = x as T;
      if (seen.has(id)) continue;
      seen.add(id);
      out.push(id);
    }
  }
  for (const id of defaultOrder) {
    if (!seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

export function usePersistedColumnOrder<T extends string>(storageKey: string, defaultOrder: readonly T[]) {
  const [order, setOrder] = useState<T[]>(() => [...defaultOrder]);
  const ignoreNextPersist = useRef(true);
  const defaultSignature = defaultOrder.join("|");

  useEffect(() => {
    ignoreNextPersist.current = true;
    try {
      const raw = localStorage.getItem(storageKey);
      const merged = mergeWithDefaults(raw ? JSON.parse(raw) : null, defaultOrder);
      setOrder(merged);
    } catch {
      setOrder([...defaultOrder]);
    }
  }, [storageKey, defaultSignature]);

  useEffect(() => {
    if (ignoreNextPersist.current) {
      ignoreNextPersist.current = false;
      return;
    }
    try {
      localStorage.setItem(storageKey, JSON.stringify(order));
    } catch {
      /* ignore */
    }
  }, [storageKey, order]);

  function moveColumn(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    setOrder((prev) => {
      if (fromIndex >= prev.length || toIndex >= prev.length) return prev;
      const next = prev.slice();
      const [removed] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, removed);
      return next;
    });
  }

  return { order, moveColumn };
}
