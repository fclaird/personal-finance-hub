import assert from "node:assert/strict";
import test from "node:test";

import {
  columnLabelKey,
  headingLabelKey,
  readColumnLabel,
  readHeadingLabel,
  writeColumnLabel,
  writeHeadingLabel,
} from "@/lib/ui/displayLabels";

const store = new Map<string, string>();

function withMockLocalStorage(fn: () => void) {
  const previous = globalThis.localStorage;
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => store.get(key) ?? null,
      setItem: (key: string, value: string) => {
        store.set(key, value);
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
    },
  });
  try {
    store.clear();
    fn();
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previous });
    store.clear();
  }
}

test("displayLabels returns defaults when no override exists", () => {
  withMockLocalStorage(() => {
    assert.equal(readHeadingLabel("fh.pages", "terminal", "Terminal"), "Terminal");
    assert.equal(readColumnLabel("fh.terminal.quotes.columns.v1", "symbol", "Symbol"), "Symbol");
  });
});

test("displayLabels persists heading overrides and clears when reset to default", () => {
  withMockLocalStorage(() => {
    writeHeadingLabel("fh.pages", "terminal", "My Desk", "Terminal");
    assert.equal(readHeadingLabel("fh.pages", "terminal", "Terminal"), "My Desk");
    writeHeadingLabel("fh.pages", "terminal", null, "Terminal");
    assert.equal(readHeadingLabel("fh.pages", "terminal", "Terminal"), "Terminal");
  });
});

test("displayLabels persists column label overrides per table", () => {
  withMockLocalStorage(() => {
    writeColumnLabel("positions:grouped:v1:noAccount", "symbol", "Ticker", "Symbol");
    assert.equal(readColumnLabel("positions:grouped:v1:noAccount", "symbol", "Symbol"), "Ticker");
    assert.equal(readColumnLabel("positions:grouped:v1:withAccount", "symbol", "Symbol"), "Symbol");
  });
});

test("displayLabels builds stable storage keys", () => {
  assert.equal(headingLabelKey("fh.alerts.tiles.v1", "recent-events"), "fh.alerts.tiles.v1::recent-events");
  assert.equal(columnLabelKey("alerts:optionContractColumns", "dte"), "alerts:optionContractColumns::dte");
});
