import assert from "node:assert/strict";
import { describe, it } from "node:test";

import type { SituationMemberView } from "@/lib/situations/apiTypes";
import {
  formatAdjustmentSummary,
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
    ...partial,
  };
}

describe("formatSituationFill", () => {
  it("translates OCC gobble into underlying / strike / expiry / action / price", () => {
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
      }),
    );
    assert.match(line, /AVGO/);
    assert.match(line, /350P/);
    assert.match(line, /Sep 11, 2026/);
    assert.match(line, /opened/);
    assert.match(line, /\$7\.78/);
  });

  it("combines roll close+open into one net adjustment line", () => {
    const summary = formatAdjustmentSummary(
      [
        m({
          transactionId: "c",
          role: "roll_close",
          tradeDate: "2026-09-03",
          symbol: "AVGO  260911C00400000",
          netAmount: -500,
          positionEffect: "CLOSING",
        }),
      ],
      [
        m({
          transactionId: "o",
          role: "roll_open",
          tradeDate: "2026-09-03",
          symbol: "AVGO  260911C00380000",
          netAmount: 800,
          positionEffect: "OPENING",
        }),
      ],
    );
    assert.match(summary.label, /AVGO/);
    assert.match(summary.label, /400C/);
    assert.match(summary.label, /380C/);
    assert.match(summary.label, /→/);
    assert.equal(summary.net, 300);
  });

  it("formats ET wall time from Schwab ISO", () => {
    const s = formatFillWhen("2026-09-04", "2026-09-04T18:21:28+0000");
    assert.match(s, /Sep 4, 2026/);
    assert.match(s, /PM|AM/);
  });
});
