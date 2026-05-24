import { usePersistedOrder } from "@/lib/usePersistedOrder";

export { mergeWithDefaults } from "@/lib/usePersistedOrder";

export function usePersistedColumnOrder<T extends string>(storageKey: string, defaultOrder: readonly T[]) {
  const { order, moveIndex } = usePersistedOrder(storageKey, defaultOrder);
  return { order, moveColumn: moveIndex };
}
