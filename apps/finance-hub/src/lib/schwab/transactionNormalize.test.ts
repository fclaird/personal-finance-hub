import assert from "node:assert/strict";
import test from "node:test";

import { tradeDateIso } from "@/lib/schwab/transactionNormalize";

test("tradeDateIso uses NY calendar date when only time is present", () => {
  // 9 PM ET on 2026-05-22 is 2026-05-23 UTC — must stay on the NY session date.
  const tx = { time: "2026-05-23T01:00:00.000Z", netAmount: -50_000 };
  assert.equal(tradeDateIso(tx), "2026-05-22");
});

test("tradeDateIso prefers explicit tradeDate", () => {
  const tx = { tradeDate: "2026-05-22", time: "2026-05-23T01:00:00.000Z" };
  assert.equal(tradeDateIso(tx), "2026-05-22");
});
