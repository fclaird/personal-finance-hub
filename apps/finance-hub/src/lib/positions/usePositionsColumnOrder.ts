"use client";

import { useCallback, useMemo } from "react";

import { usePersistedOrder } from "@/lib/usePersistedOrder";

import {
  POSITIONS_COLUMN_DEFAULT_ORDER,
  POSITIONS_COLUMN_ORDER_LEGACY_KEYS,
  POSITIONS_COLUMN_ORDER_STORAGE_KEY,
  type PositionsColumnId,
} from "./positionsColumnOrder";

export function usePositionsColumnOrder(available: readonly PositionsColumnId[]) {
  const availableKey = available.join("|");
  const availableSet = useMemo(() => new Set(available), [availableKey]);

  const { order: globalOrder, reorderById } = usePersistedOrder(
    POSITIONS_COLUMN_ORDER_STORAGE_KEY,
    POSITIONS_COLUMN_DEFAULT_ORDER,
    POSITIONS_COLUMN_ORDER_LEGACY_KEYS,
  );

  const order = useMemo(
    () => globalOrder.filter((c) => availableSet.has(c)),
    [globalOrder, availableSet],
  );

  const moveColumn = useCallback(
    (fromIndex: number, toIndex: number) => {
      const visible = globalOrder.filter((c) => availableSet.has(c));
      const fromId = visible[fromIndex];
      const toId = visible[toIndex];
      if (!fromId || !toId || fromId === toId) return;
      reorderById(fromId, toId);
    },
    [globalOrder, availableSet, reorderById],
  );

  return { order, moveColumn };
}
