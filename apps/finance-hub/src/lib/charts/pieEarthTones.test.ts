import assert from "node:assert/strict";
import test from "node:test";

import {
  assignColorsForAdjacentContrast,
  assignEarthToneColorsBySymbols,
  distinctColorForIndex,
  EARTH_TONE_PIE_COLORS,
} from "@/lib/charts/pieEarthTones";

const BANNED_PURPLE_HEX = new Set(["#7c3aed", "#9333ea", "#c026d3", "#4f46e5", "#db2777", "#a855f7", "#8b5cf6"]);

test("palette excludes purple and violet hex colors", () => {
  for (const c of EARTH_TONE_PIE_COLORS) {
    assert.ok(!BANNED_PURPLE_HEX.has(c.toLowerCase()), `banned purple in palette: ${c}`);
  }
  for (let i = 0; i < 30; i++) {
    const c = distinctColorForIndex(i).toLowerCase();
    assert.ok(!BANNED_PURPLE_HEX.has(c), `banned purple at index ${i}: ${c}`);
  }
});

test("assignColorsForAdjacentContrast separates consecutive picks", () => {
  const colors = assignColorsForAdjacentContrast(8);
  assert.equal(colors.length, 8);
  for (let i = 1; i < colors.length; i++) {
    assert.notEqual(colors[i], colors[i - 1]);
  }
});

test("assignEarthToneColorsBySymbols preserves display order for contrast", () => {
  const map = assignEarthToneColorsBySymbols(["RKLB", "TSLA", "PLTR", "BMNR"]);
  assert.notEqual(map.get("RKLB"), map.get("TSLA"));
  assert.notEqual(map.get("TSLA"), map.get("PLTR"));
});
