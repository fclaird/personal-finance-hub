import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SituationMemberView } from "@/lib/situations/apiTypes";
import {
  buildAdjustmentHighlightParts,
  formatAdjustmentSummary,
  formatCurrentDteLabel,
  formatFillLine,
  formatFillWhen,
} from "@/lib/situations/formatSituationFill";

function m(partial: Partial<SituationMemberView> & Pick<SituationMemberView, "transactionId" | "role" | "tradeDate">): SituationMemberView {
  return {
    tradeTime: null,
    symbol: null,
    underlying: null,
    expiration: null,
    right: null,
    strike: null,
    price: null,
    quantity: null,
    positionEffect: null,
    netAmount: null,
    instruction: null,
    description: null,
    orderId: null,
    deltaAtFill: null,
    ...partial,
  };
}

describe("formatSituationFill", () => {
  it("shows DTE primary with secondary trade date + delta", () => {
    const line = formatFillLine(
      m({
        transactionId: "1",
        role: "open",
        tradeDate: "2026-09-02",
        tradeTime: "2026-09-02T14:30:00+0000",
        symbol: "AVGO  260911P00350000",
        price: 7.78,
        quantity: -10,
        positionEffect: "OPENING",
        netAmount: 7770,
        deltaAtFill: -0.14,
      }),
    );
    assert.match(line, /AVGO/);
    assert.match(line, /350P/);
    assert.match(line, /opened/);
    assert.match(line, /9 DTE/);
    assert.match(line, /Sep 2/); // secondary trade date
    assert.match(line, /Δ −0\.14|Δ -0\.14/);
    assert.match(line, /\$7\.78/);
    assert.doesNotMatch(line, /Sep 11/); // no expiry calendar
    assert.doesNotMatch(line, /\bexp\b/i);
    assert.doesNotMatch(line, /3:26|PM|AM/); // no wall-clock time
  });

  it("adjustment headline uses DTE from→to when expiry changes", () => {
    const summary = formatAdjustmentSummary(
      [
        m({
          transactionId: "c",
          role: "roll_close",
          tradeDate: "2026-09-03",
          tradeTime: "2026-09-03T14:00:00+0000",
          symbol: "BE    260904P00210000",
          expiration: "2026-09-04",
          netAmount: -500,
          positionEffect: "CLOSING",
        }),
      ],
      [
        m({
          transactionId: "o",
          role: "roll_open",
          tradeDate: "2026-09-03",
          tradeTime: "2026-09-03T14:00:00+0000",
          symbol: "BE    260918P00230000",
          expiration: "2026-09-18",
          netAmount: 800,
          positionEffect: "OPENING",
        }),
      ],
    );
    assert.match(summary.label, /BE/);
    assert.match(summary.label, /210P/);
    assert.match(summary.label, /230P/);
    assert.match(summary.label, /1 DTE → 15 DTE/);
    assert.match(summary.label, /Sep 3/); // secondary trade date
    assert.equal(summary.net, 300);
    assert.doesNotMatch(summary.label, /REALIZED/i);
    assert.doesNotMatch(summary.label, /\$/);
  });

  it("current tip live DTE from OCC symbols", () => {
    // Freeze "today" as 2026-09-06 ET by constructing a UTC noon that maps to Sep 6 NY
    const now = new Date("2026-09-06T16:00:00Z");
    const label = formatCurrentDteLabel(["AVGO  260911P00350000", "AVGO  260911C00400000"], now);
    assert.equal(label, "5 DTE");
  });

  it("formats ET wall time from Schwab ISO (legacy helper)", () => {
    const s = formatFillWhen("2026-09-04", "2026-09-04T18:21:28+0000");
    assert.match(s, /Sep 4, 2026/);
    assert.match(s, /PM|AM/);
  });

  it("highlights changed wings and DTE for BE 210P/225C → 210P/235C", () => {
    const parts = buildAdjustmentHighlightParts(
      [
        m({
          transactionId: "cP",
          role: "roll_close",
          tradeDate: "2026-08-27",
          tradeTime: "2026-08-27T14:00:00+0000",
          symbol: "BE    260828P00210000",
          expiration: "2026-08-28",
          right: "P",
          strike: 210,
          positionEffect: "CLOSING",
        }),
        m({
          transactionId: "cC",
          role: "roll_close",
          tradeDate: "2026-08-27",
          tradeTime: "2026-08-27T14:00:00+0000",
          symbol: "BE    260828C00225000",
          expiration: "2026-08-28",
          right: "C",
          strike: 225,
          positionEffect: "CLOSING",
        }),
      ],
      [
        m({
          transactionId: "oP",
          role: "roll_open",
          tradeDate: "2026-08-27",
          tradeTime: "2026-08-27T14:00:00+0000",
          symbol: "BE    260904P00210000",
          expiration: "2026-09-04",
          right: "P",
          strike: 210,
          positionEffect: "OPENING",
        }),
        m({
          transactionId: "oC",
          role: "roll_open",
          tradeDate: "2026-08-27",
          tradeTime: "2026-08-27T14:00:00+0000",
          symbol: "BE    260904C00235000",
          expiration: "2026-09-04",
          right: "C",
          strike: 235,
          positionEffect: "OPENING",
        }),
      ],
    );
    const tokens = parts.filter((p) => p.kind === "token");
    const byText = Object.fromEntries(tokens.map((p) => [p.text, p.changed]));
    assert.equal(byText["210P"], false, "210P unchanged");
    assert.equal(byText["225C"], true, "225C changed");
    assert.equal(byText["235C"], true, "235C changed");
    assert.equal(byText["1 DTE"], true, "from DTE changed");
    assert.equal(byText["8 DTE"], true, "to DTE changed");
    // only one 210P token should be unchanged on both sides — count unchanged 210P
    const putTokens = tokens.filter((p) => p.text === "210P");
    assert.equal(putTokens.length, 2);
    assert.ok(putTokens.every((p) => p.changed === false));
    const label = parts.map((p) => p.text).join("");
    assert.match(label, /BE adjust 210P\/225C → 210P\/235C/);
    assert.match(label, /1 DTE → 8 DTE/);
    assert.match(label, /Aug 27/);
    assert.doesNotMatch(label, /REALIZED/i);
    assert.doesNotMatch(label, /\$/);
  });
});
