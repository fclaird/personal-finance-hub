import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { buildEventCalendar, flagOptionsWithEvents } from "@/lib/events/eventCalendar";
import { fomcEventsBetween } from "@/lib/events/fomcCalendar";

const today = "2026-10-11";

describe("event calendar", () => {
  it("lists the published October and December 2026 FOMC decisions inside a 90-day window", () => {
    const dates = fomcEventsBetween(today, "2027-01-09").map((event) => event.date);
    assert.deepEqual(dates, ["2026-10-28", "2026-12-09"]);
    const nextYear = fomcEventsBetween("2027-01-01", "2027-01-31");
    assert.equal(nextYear[0]?.date, "2027-01-27");
    assert.equal(nextYear[0]?.tentative, true);
  });

  it("keeps earnings and ex-dividend for the universe and flags options that expire after the event", () => {
    const view = buildEventCalendar({
      today,
      through: "2026-12-31",
      symbols: ["now", "AAPL"],
      earnings: [
        { symbol: "NOW", date: "2026-11-05", timeOfDay: "amc", source: "finnhub" },
        { symbol: "MSFT", date: "2026-11-01", timeOfDay: null, source: "finnhub" },
        { symbol: "NOW", date: "2026-12-20", timeOfDay: "bmo", source: "finnhub" },
      ],
      exDividends: [{ symbol: "AAPL", date: "2026-11-07", source: "cashflows" }],
      options: [
        { positionId: "p1", underlying: "NOW", expiry: "2026-11-20", label: "NOW Nov 150 C" },
        { positionId: "p2", underlying: "NOW", expiry: "2026-10-16", label: "NOW Oct 150 C" },
        { positionId: "p3", underlying: "AAPL", expiry: "2026-12-18", label: "AAPL Dec 200 C" },
      ],
      moves: [],
    });
    const kinds = view.events.filter((event) => event.symbol === "NOW" || event.symbol === "AAPL").map((event) => `${event.kind}:${event.symbol}:${event.date}`);
    assert.deepEqual(kinds, ["earnings:NOW:2026-11-05", "ex-dividend:AAPL:2026-11-07", "earnings:NOW:2026-12-20"]);
    assert.ok(view.events.some((event) => event.kind === "fomc" && event.date === "2026-10-28"));
    const nowNov = view.flagged.find((row) => row.positionId === "p1");
    assert.ok(nowNov);
    assert.ok(nowNov.events.some((event) => event.kind === "earnings" && event.date === "2026-11-05"));
    assert.ok(nowNov.events.some((event) => event.kind === "fomc" && event.date === "2026-10-28"));
    assert.equal(nowNov.events.some((event) => event.date === "2026-12-20"), false);
    const nowOct = view.flagged.find((row) => row.positionId === "p2");
    assert.equal(nowOct, undefined);
    const aapl = view.flagged.find((row) => row.positionId === "p3");
    assert.ok(aapl?.events.some((event) => event.kind === "ex-dividend"));
    assert.equal(aapl?.events.some((event) => event.symbol === "NOW"), false);
  });

  it("does not flag an option that has already expired", () => {
    const flagged = flagOptionsWithEvents(
      [{ id: "fomc_2026-10-28", kind: "fomc", date: "2026-10-28", symbol: null, label: "FOMC decision", source: "fed" }],
      [{ positionId: "old", underlying: "NOW", expiry: "2026-10-09", label: "old" }],
      today,
    );
    assert.equal(flagged.length, 0);
  });
});
