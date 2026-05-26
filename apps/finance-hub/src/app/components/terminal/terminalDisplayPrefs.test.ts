import assert from "node:assert/strict";
import test from "node:test";

import {
  readHeatmapHiddenSymbols,
  readGlanceAlternateInstrument,
  readOptionFlowMode,
  readQuotesSort,
  readTerminalTableColumnOrder,
  readVolumeLeadersMode,
  readWatchlistId,
  writeHeatmapHiddenSymbols,
  writeGlanceAlternateInstrument,
  writeOptionFlowMode,
  writeQuotesSort,
  writeTerminalTableColumnOrder,
  writeVolumeLeadersMode,
  writeWatchlistId,
} from "@/app/components/terminal/terminalDisplayPrefs";

const store = new Map<string, string>();

test("terminal display prefs round-trip in localStorage", () => {
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
    writeGlanceAlternateInstrument("us-cl");
    assert.equal(readGlanceAlternateInstrument(), "us-cl");

    writeWatchlistId("wl-123");
    assert.equal(readWatchlistId(), "wl-123");

    writeQuotesSort("symbol", true);
    assert.deepEqual(readQuotesSort(), { col: "symbol", asc: true });

    writeVolumeLeadersMode("volX");
    assert.equal(readVolumeLeadersMode(), "volX");

    writeOptionFlowMode("relative");
    assert.equal(readOptionFlowMode(), "relative");

    writeTerminalTableColumnOrder(["symbol", "last", "chgPct", "company", "chg", "volume", "volX"]);
    const order = readTerminalTableColumnOrder(["symbol", "company", "last", "chg", "chgPct", "volume", "volX"]);
    assert.deepEqual(order, ["symbol", "last", "chgPct", "company", "chg", "volume", "volX"]);

    writeWatchlistId(null);
    assert.equal(readWatchlistId(), null);

    writeHeatmapHiddenSymbols(new Set(["SPY", "qqq"]));
    const hidden = readHeatmapHiddenSymbols();
    assert.ok(hidden.has("SPY"));
    assert.ok(hidden.has("QQQ"));
    assert.equal(hidden.size, 2);

    writeHeatmapHiddenSymbols(new Set());
    assert.equal(readHeatmapHiddenSymbols().size, 0);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: previous });
    store.clear();
  }
});
