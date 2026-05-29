import assert from "node:assert/strict";
import test from "node:test";

import {
  readSidebarCollapsed,
  SIDEBAR_COLLAPSED_STORAGE_KEY,
  writeSidebarCollapsed,
} from "@/app/lib/sidebarNav";

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

test("writeSidebarCollapsed and readSidebarCollapsed round-trip", () => {
  const ls = createLocalStorageMock();
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
  try {
    writeSidebarCollapsed(true);
    assert.equal(ls.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY), "1");
    assert.equal(readSidebarCollapsed(), true);
    writeSidebarCollapsed(false);
    assert.equal(ls.getItem(SIDEBAR_COLLAPSED_STORAGE_KEY), "0");
    assert.equal(readSidebarCollapsed(), false);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: prev, configurable: true });
  }
});
