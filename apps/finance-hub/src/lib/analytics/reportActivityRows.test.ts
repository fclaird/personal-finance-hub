import assert from "node:assert/strict";
import test from "node:test";

import { mostRecentActiveKey } from "@/lib/analytics/reportActivityRows";

test("mostRecentActiveKey opens the latest row with trades and skips a trailing empty day", () => {
  const open = mostRecentActiveKey([
    { key: "2026-10-05", tradeCount: 2 },
    { key: "2026-10-06", tradeCount: 0 },
    { key: "2026-10-07", tradeCount: 0 },
  ]);
  assert.equal(open, "2026-10-05");
});

test("mostRecentActiveKey prefers a later active row over an earlier one", () => {
  const open = mostRecentActiveKey([
    { key: "2026-09", tradeCount: 1 },
    { key: "2026-10", tradeCount: 4 },
  ]);
  assert.equal(open, "2026-10");
});

test("mostRecentActiveKey returns null when every row is empty", () => {
  assert.equal(
    mostRecentActiveKey([
      { key: "2026-03", tradeCount: 0 },
      { key: "2026-04", tradeCount: 0 },
    ]),
    null,
  );
  assert.equal(mostRecentActiveKey([]), null);
});
