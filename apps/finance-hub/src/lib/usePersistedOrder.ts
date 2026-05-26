import { useCallback, useEffect, useRef, useState } from "react";

/** Restore saved order; keep valid ids in order, append any new ids from defaultOrder. */
export function mergeWithDefaults<T extends string>(saved: unknown, defaultOrder: readonly T[]): T[] {
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

function readPersistedOrder<T extends string>(
  storageKey: string,
  defaultOrder: readonly T[],
  legacyStorageKeys?: readonly string[],
): T[] {
  const keys = [storageKey, ...(legacyStorageKeys ?? [])];
  for (const key of keys) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) continue;
      const merged = mergeWithDefaults(JSON.parse(raw) as unknown, defaultOrder);
      if (merged.length > 0) return merged;
    } catch {
      // try next key
    }
  }
  return [...defaultOrder];
}

export function usePersistedOrder<T extends string>(
  storageKey: string,
  defaultOrder: readonly T[],
  legacyStorageKeys?: readonly string[],
) {
  const [order, setOrder] = useState<T[]>(() => [...defaultOrder]);
  const ignoreNextPersist = useRef(true);
  const defaultSignature = defaultOrder.join("|");
  const legacySignature = legacyStorageKeys?.join("|") ?? "";

  useEffect(() => {
    ignoreNextPersist.current = true;
    setOrder(readPersistedOrder(storageKey, defaultOrder, legacyStorageKeys));
  }, [storageKey, defaultSignature, legacySignature]);

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

  function moveIndex(fromIndex: number, toIndex: number) {
    if (fromIndex === toIndex || fromIndex < 0 || toIndex < 0) return;
    setOrder((prev) => {
      if (fromIndex >= prev.length || toIndex >= prev.length) return prev;
      const next = prev.slice();
      const [removed] = next.splice(fromIndex, 1);
      next.splice(toIndex, 0, removed);
      return next;
    });
  }

  function reorderById(sourceId: T, targetId: T) {
    if (sourceId === targetId) return;
    setOrder((prev) => {
      const i = prev.indexOf(sourceId);
      const j = prev.indexOf(targetId);
      if (i < 0 || j < 0) return prev;
      const next = [...prev];
      next.splice(i, 1);
      next.splice(j, 0, sourceId);
      return next;
    });
  }

  return { order, setOrder, moveIndex, reorderById };
}

function parseCollapsedIds(raw: string | null): Set<string> {
  if (!raw) return new Set();
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) return new Set();
    return new Set(parsed.filter((x): x is string => typeof x === "string"));
  } catch {
    return new Set();
  }
}

/** Collapsed tile ids persisted under `{storageKey}.collapsed.v1`. */
export function usePersistedCollapsedSet(storageKey: string) {
  const collapseKey = `${storageKey}.collapsed.v1`;
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set());
  const ignoreNextPersist = useRef(true);

  useEffect(() => {
    ignoreNextPersist.current = true;
    try {
      setCollapsed(parseCollapsedIds(localStorage.getItem(collapseKey)));
    } catch {
      setCollapsed(new Set());
    }
  }, [collapseKey]);

  useEffect(() => {
    if (ignoreNextPersist.current) {
      ignoreNextPersist.current = false;
      return;
    }
    try {
      localStorage.setItem(collapseKey, JSON.stringify([...collapsed]));
    } catch {
      /* ignore */
    }
  }, [collapseKey, collapsed]);

  const toggleCollapsed = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isCollapsed = useCallback((id: string) => collapsed.has(id), [collapsed]);

  return { collapsed, isCollapsed, toggleCollapsed, setCollapsed };
}
