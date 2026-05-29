import assert from "node:assert/strict";
import test from "node:test";

import {
  mergeWithDefaults,
  persistOrder,
  readPersistedOrder,
} from "@/lib/usePersistedOrder";

const STORAGE_KEY = "test.persisted.order.v1";
const DEFAULT_ORDER = ["a", "b", "c", "d"] as const;

function createLocalStorageMock(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.has(key) ? store.get(key)! : null;
    },
    key(index: number) {
      return [...store.keys()][index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    },
  };
}

test("mergeWithDefaults keeps saved order and appends new ids", () => {
  const merged = mergeWithDefaults(["c", "a"], DEFAULT_ORDER);
  assert.deepEqual(merged, ["c", "a", "b", "d"]);
});

test("mergeWithDefaults drops unknown ids", () => {
  const merged = mergeWithDefaults(["z", "b", "a"], DEFAULT_ORDER);
  assert.deepEqual(merged, ["b", "a", "c", "d"]);
});

test("persistOrder writes JSON array to localStorage", () => {
  const ls = createLocalStorageMock();
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
  try {
    persistOrder(STORAGE_KEY, ["/performance", "/terminal"]);
    assert.equal(ls.getItem(STORAGE_KEY), JSON.stringify(["/performance", "/terminal"]));
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: prev, configurable: true });
  }
});

test("readPersistedOrder restores merged order from storage", () => {
  const ls = createLocalStorageMock();
  ls.setItem(STORAGE_KEY, JSON.stringify(["d", "b"]));
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
  try {
    const order = readPersistedOrder(STORAGE_KEY, DEFAULT_ORDER);
    assert.deepEqual(order, ["d", "b", "a", "c"]);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: prev, configurable: true });
  }
});
