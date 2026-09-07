import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { clumpLinkablePartials } from "@/lib/situations/fromBrokerTx";
import { proposeSituations } from "@/lib/situations/linkSituations";
import type { LinkableTxn } from "@/lib/situations/types";

function leg(
  symbol: string,
  right: "C" | "P",
  strike: number,
  exp: string,
  instruction: "sell_open" | "buy_close",
  quantity: number,
) {
  return {
    symbol,
    underlying: "BE",
    expiration: exp,
    right,
    strike,
    instruction,
    opening: instruction === "sell_open",
    quantity,
  };
}

function txn(
  id: string,
  date: string,
  time: string,
  orderId: string,
  net: number,
  legs: LinkableTxn["legs"],
  price = 1,
): LinkableTxn {
  return {
    id,
    accountId: "acct",
    tradeDate: date,
    tradeTime: time,
    orderId,
    netAmount: net,
    price,
    legs,
    sourceTransactionIds: [id],
  };
}

describe("BE partial-fill order clumping + same-order adjustments", () => {
  it("17+3 same orderId opens become one 20× strangle; same-order roll is adjustment not leg", () => {
    const raw: LinkableTxn[] = [
      // Initial 20-lot strangle via two orders of 10 (mergeSameDay) — simplified as two 10s same day
      txn("o-p10a", "2026-08-21", "2026-08-21T14:00:00+0000", "ord-a", 1000, [
        leg("BE 175P", "P", 175, "2026-08-28", "sell_open", -10),
      ]),
      txn("o-c10a", "2026-08-21", "2026-08-21T14:00:00+0000", "ord-a", 2000, [
        leg("BE 225C", "C", 225, "2026-08-28", "sell_open", -10),
      ]),
      txn("o-p10b", "2026-08-21", "2026-08-21T14:05:00+0000", "ord-b", 1000, [
        leg("BE 175P", "P", 175, "2026-08-28", "sell_open", -10),
      ]),
      txn("o-c10b", "2026-08-21", "2026-08-21T14:05:00+0000", "ord-b", 2000, [
        leg("BE 225C", "C", 225, "2026-08-28", "sell_open", -10),
      ]),
      // Aug 26 put roll 175→210 at 4+16 = 20 (same orderId)
      txn("r26-c4", "2026-08-26", "2026-08-26T15:00:00+0000", "1007714827235", -40, [
        leg("BE 175P", "P", 175, "2026-08-28", "buy_close", 4),
      ]),
      txn("r26-o4", "2026-08-26", "2026-08-26T15:00:00+0000", "1007714827235", 900, [
        leg("BE 210P", "P", 210, "2026-08-28", "sell_open", -4),
      ]),
      txn("r26-c16", "2026-08-26", "2026-08-26T15:00:01+0000", "1007714827235", -160, [
        leg("BE 175P", "P", 175, "2026-08-28", "buy_close", 16),
      ]),
      txn("r26-o16", "2026-08-26", "2026-08-26T15:00:01+0000", "1007714827235", 3600, [
        leg("BE 210P", "P", 210, "2026-08-28", "sell_open", -16),
      ]),
      // Aug 27 full strangle roll (same order) — must NOT be leg
      txn("r27-cp", "2026-08-27", "2026-08-27T15:00:00+0000", "1007730197024", -3500, [
        leg("BE 210P", "P", 210, "2026-08-28", "buy_close", 20),
      ]),
      txn("r27-cc", "2026-08-27", "2026-08-27T15:00:00+0000", "1007730197024", -8300, [
        leg("BE 225C", "C", 225, "2026-08-28", "buy_close", 20),
      ]),
      txn("r27-op", "2026-08-27", "2026-08-27T15:00:00+0000", "1007730197024", 15000, [
        leg("BE 210P", "P", 210, "2026-09-04", "sell_open", -20),
      ]),
      txn("r27-oc", "2026-08-27", "2026-08-27T15:00:00+0000", "1007730197024", 15000, [
        leg("BE 235C", "C", 235, "2026-09-04", "sell_open", -20),
      ]),
      // Sep 3 roll with 17+3 partials on each leg
      txn("r93-cp3", "2026-09-03", "2026-09-03T15:28:28+0000", "1007816464950", -3000, [
        leg("BE 210P", "P", 210, "2026-09-04", "buy_close", 3),
      ]),
      txn("r93-cc3", "2026-09-03", "2026-09-03T15:28:28+0000", "1007816464950", -3800, [
        leg("BE 235C", "C", 235, "2026-09-04", "buy_close", 3),
      ]),
      txn("r93-op3", "2026-09-03", "2026-09-03T15:28:28+0000", "1007816464950", 4600, [
        leg("BE 230P", "P", 230, "2026-09-18", "sell_open", -3),
      ]),
      txn("r93-oc3", "2026-09-03", "2026-09-03T15:28:28+0000", "1007816464950", 3700, [
        leg("BE 245C", "C", 245, "2026-09-18", "sell_open", -3),
      ]),
      txn("r93-cp17", "2026-09-03", "2026-09-03T15:28:29+0000", "1007816464950", -16800, [
        leg("BE 210P", "P", 210, "2026-09-04", "buy_close", 17),
      ]),
      txn("r93-cc17", "2026-09-03", "2026-09-03T15:28:29+0000", "1007816464950", -21400, [
        leg("BE 235C", "C", 235, "2026-09-04", "buy_close", 17),
      ]),
      txn("r93-op17", "2026-09-03", "2026-09-03T15:28:29+0000", "1007816464950", 26300, [
        leg("BE 230P", "P", 230, "2026-09-18", "sell_open", -17),
      ]),
      txn("r93-oc17", "2026-09-03", "2026-09-03T15:28:29+0000", "1007816464950", 21100, [
        leg("BE 245C", "C", 245, "2026-09-18", "sell_open", -17),
      ]),
    ];

    const clumped = clumpLinkablePartials(raw);
    const putOpenSep = clumped.find(
      (t) => t.legs[0]?.strike === 230 && t.legs[0]?.instruction === "sell_open",
    );
    assert.ok(putOpenSep);
    assert.equal(putOpenSep!.legs[0]!.quantity, -20);
    assert.equal(putOpenSep!.sourceTransactionIds?.length, 2);

    const rows = proposeSituations(clumped);
    assert.equal(rows.length, 1, `expected one BE book, got ${rows.length}: ${rows.map((r) => r.title + "/" + r.status).join("; ")}`);
    const sit = rows[0]!;
    assert.equal(sit.kind, "short-strangle");
    assert.equal(sit.status, "open");
    assert.ok(!sit.members.some((m) => m.role === "leg"), "no spurious leg roles on BE rolls");

    const roles = sit.members.map((m) => m.role);
    assert.ok(roles.filter((r) => r === "open").length >= 2);
    assert.ok(roles.includes("roll_close"));
    assert.ok(roles.includes("roll_open"));

    // Aug 26 clumped put roll should be present once each (close+open)
    const aug26Closes = clumped.filter(
      (t) => t.orderId === "1007714827235" && t.legs[0]?.instruction === "buy_close",
    );
    assert.equal(aug26Closes.length, 1);
    assert.equal(aug26Closes[0]!.legs[0]!.quantity, 20);

    // Final opens are 230P + 245C at 20
    const finalOpens = clumped.filter(
      (t) => t.orderId === "1007816464950" && t.legs[0]?.instruction === "sell_open",
    );
    assert.equal(finalOpens.length, 2);
    assert.ok(finalOpens.every((t) => Math.abs(t.legs[0]!.quantity ?? 0) === 20));
  });
});
