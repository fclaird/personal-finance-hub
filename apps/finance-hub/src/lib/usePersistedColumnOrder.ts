import { usePersistedOrder } from "@/lib/usePersistedOrder";

export { mergeWithDefaults } from "@/lib/usePersistedOrder";

export function usePersistedColumnOrder<T extends string>(
  storageKey: string,
  defaultOrder: readonly T[],
  legacyStorageKeys?: readonly string[],
) {
  const { order, moveIndex, reorderById } = usePersistedOrder(storageKey, defaultOrder, legacyStorageKeys);
  return { order, moveColumn: moveIndex, reorderById };
}
