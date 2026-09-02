import assert from "node:assert/strict";
import test from "node:test";

import {
  defaultSidebarNavOrder,
  readSidebarNavOrderFromStorage,
  SIDEBAR_NAV_ORDER_LEGACY_KEYS_MAIN,
  sidebarNavOrderStorageKeyForFlavor,
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

test("readSidebarNavOrderFromStorage migrates legacy main key", () => {
  const ls = createLocalStorageMock();
  ls.setItem(SIDEBAR_NAV_ORDER_LEGACY_KEYS_MAIN[0]!, JSON.stringify(["/performance", "/terminal"]));
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
  try {
    const order = readSidebarNavOrderFromStorage("main");
    assert.ok(order.indexOf("/performance") < order.indexOf("/terminal"));
    assert.equal(order[0], "/performance");
    assert.equal(order[1], "/terminal");
    assert.equal(ls.getItem(sidebarNavOrderStorageKeyForFlavor("main")), JSON.stringify(order));
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: prev, configurable: true });
  }
});

test("readSidebarNavOrderFromStorage remaps legacy /strategies/all to situations", () => {
  const ls = createLocalStorageMock();
  const key = sidebarNavOrderStorageKeyForFlavor("main");
  ls.setItem(key, JSON.stringify(["/terminal", "/strategies/all", "/positions"]));
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
  try {
    const order = readSidebarNavOrderFromStorage("main");
    assert.equal(order[0], "/terminal");
    assert.equal(order[1], "/strategies/situations");
    assert.equal(order[2], "/positions");
    assert.equal(order.includes("/strategies/all"), false);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: prev, configurable: true });
  }
});

test("readSidebarNavOrderFromStorage uses per-flavor key for rorie", () => {
  const ls = createLocalStorageMock();
  const rorieKey = sidebarNavOrderStorageKeyForFlavor("rorie");
  ls.setItem(rorieKey, JSON.stringify(["/alerts", "/terminal"]));
  const prev = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", { value: ls, configurable: true });
  try {
    const order = readSidebarNavOrderFromStorage("rorie");
    assert.equal(order[0], "/alerts");
    assert.equal(order[1], "/terminal");
    for (const href of defaultSidebarNavOrder("rorie")) {
      if (href !== "/alerts" && href !== "/terminal") assert.ok(order.includes(href));
    }
  } finally {
    Object.defineProperty(globalThis, "localStorage", { value: prev, configurable: true });
  }
});
