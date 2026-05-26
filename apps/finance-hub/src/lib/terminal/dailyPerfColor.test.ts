import assert from "node:assert/strict";
import test from "node:test";

import {
  heatmapCellStyle,
  perfCellForegroundStyle,
  PERF_CELL_LABEL_COLOR,
  treemapLabelColor,
} from "@/lib/terminal/dailyPerfColor";

test("treemapLabelColor always returns high-contrast light text", () => {
  assert.equal(treemapLabelColor(0.053), PERF_CELL_LABEL_COLOR);
  assert.equal(treemapLabelColor(-0.033), PERF_CELL_LABEL_COLOR);
  assert.equal(treemapLabelColor(0), PERF_CELL_LABEL_COLOR);
  assert.equal(treemapLabelColor(null), PERF_CELL_LABEL_COLOR);
});

test("perfCellForegroundStyle includes readable shadow", () => {
  const style = perfCellForegroundStyle();
  assert.equal(style.color, PERF_CELL_LABEL_COLOR);
  assert.match(String(style.textShadow), /rgba\(0,0,0/);
});

test("heatmapCellStyle keeps backgrounds in a mid-dark range for light labels", () => {
  const gain = heatmapCellStyle(0.053).backgroundColor as string;
  const loss = heatmapCellStyle(-0.033).backgroundColor as string;
  const flat = heatmapCellStyle(0).backgroundColor as string;
  assert.match(gain, /hsl\(/);
  assert.match(loss, /hsl\(/);
  assert.match(flat, /hsl\(/);
  for (const bg of [gain, loss, flat]) {
    const lMatch = bg.match(/(\d+(?:\.\d+)?)%\)$/);
    assert.ok(lMatch, `expected lightness in ${bg}`);
    const lightness = Number(lMatch[1]);
    assert.ok(lightness >= 26 && lightness <= 50, `lightness ${lightness} out of readable range for ${bg}`);
  }
});
