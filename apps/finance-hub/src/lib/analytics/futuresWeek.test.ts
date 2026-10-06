import assert from "node:assert/strict";
import test from "node:test";

import {
  clippedMonthWeeks,
  formatMonthDayRange,
  formatWeekOfLabel,
  formatWeekdayDateLabel,
  futuresSessionYmd,
  futuresWeekByMonday,
  futuresWeekContaining,
  monthKeyForTrade,
  monthWeekPortions,
  rollingFuturesWeeks,
  sessionYmdForTrade,
  spillSessionYmds,
  tradeFallsInWeeks,
  weekendSessionTrades,
  ytdMonthsThrough,
} from "@/lib/analytics/futuresWeek";

test("Sunday 6:00 PM ET rolls to Monday in standard time and daylight time", () => {
  assert.equal(futuresSessionYmd(new Date("2026-01-04T17:59:00-05:00")), "2026-01-04");
  assert.equal(futuresSessionYmd(new Date("2026-01-04T18:00:00-05:00")), "2026-01-05");

  assert.equal(futuresSessionYmd(new Date("2026-03-08T17:59:00-04:00")), "2026-03-08");
  assert.equal(futuresSessionYmd(new Date("2026-03-08T18:00:00-04:00")), "2026-03-09");

  assert.equal(futuresSessionYmd(new Date("2026-11-01T17:59:00-05:00")), "2026-11-01");
  assert.equal(futuresSessionYmd(new Date("2026-11-01T18:00:00-05:00")), "2026-11-02");
});

test("a week runs Monday through the following Sunday and opens the evening before", () => {
  const tuesday = new Date("2026-10-06T15:00:00-04:00");
  const week = futuresWeekContaining(tuesday);
  assert.equal(week.mondayYmd, "2026-10-05");
  assert.equal(week.openSundayYmd, "2026-10-04");
  assert.equal(week.closeSundayYmd, "2026-10-11");
  assert.equal(formatMonthDayRange(week.mondayYmd, week.closeSundayYmd), "Oct 5 \u2013 Oct 11");
  assert.equal(formatWeekdayDateLabel("2026-10-05"), "Monday, Oct 5");
  assert.equal(futuresSessionYmd(new Date(week.opensAtMs)), "2026-10-05");
  assert.equal(futuresSessionYmd(new Date(week.closesAtMs)), "2026-10-12");
});

test("Sunday before 6:00 PM stays in the prior week", () => {
  const afternoon = futuresWeekContaining(new Date("2026-10-04T15:00:00-04:00"));
  const evening = futuresWeekContaining(new Date("2026-10-04T18:00:00-04:00"));
  assert.equal(afternoon.mondayYmd, "2026-09-28");
  assert.equal(evening.mondayYmd, "2026-10-05");
});

test("Sunday evening trades land on Monday and bare Sunday dates stay on Sunday", () => {
  const week = futuresWeekByMonday("2026-10-05");
  const trades = [
    { tradeDate: "2026-10-10", id: "sat" },
    { tradeDate: "2026-10-11", id: "sun-noon" },
    { tradeDate: "2026-10-04", tradedAt: "2026-10-04T22:30:00.000Z", id: "sun-evening" },
    { tradeDate: "2026-10-05", id: "mon" },
  ];

  assert.equal(sessionYmdForTrade(trades[1]!), "2026-10-11");
  assert.equal(sessionYmdForTrade(trades[2]!), "2026-10-05");
  assert.equal(tradeFallsInWeeks(trades[2]!, [week]), true);
  assert.equal(tradeFallsInWeeks({ tradeDate: "2026-10-04" }, [week]), false);

  const hidden = weekendSessionTrades(trades, week.days).map((trade) => trade.id);
  assert.deepEqual(hidden.sort(), ["sat", "sun-noon"]);
});

test("rolling five weeks are whole weeks, newest first", () => {
  const weeks = rollingFuturesWeeks(new Date("2026-10-06T15:00:00-04:00"), 5);
  assert.deepEqual(
    weeks.map((week) => week.mondayYmd),
    ["2026-10-05", "2026-09-28", "2026-09-21", "2026-09-14", "2026-09-07"],
  );
  assert.equal(weeks[4]!.openSundayYmd, "2026-09-06");
  assert.equal(weeks[0]!.closeSundayYmd, "2026-10-11");
  for (const week of weeks) {
    assert.equal(week.days.length, 7);
    assert.equal(week.days[0]!.ymd, week.mondayYmd);
    assert.equal(week.days[6]!.ymd, week.closeSundayYmd);
  }
});

test("October 2026 clips week 1 and keeps a fifth week inside the month", () => {
  const weeks = clippedMonthWeeks(2026, 10);
  assert.equal(weeks.length, 5);
  assert.equal(weeks[0]!.weekNumber, 1);
  assert.equal(weeks[0]!.clippedStartYmd, "2026-10-01");
  assert.equal(weeks[0]!.clippedEndYmd, "2026-10-04");
  assert.deepEqual(
    weeks[0]!.clippedDays.map((day) => day.weekday),
    ["Thursday", "Friday", "Saturday", "Sunday"],
  );
  assert.equal(weeks[0]!.clippedDays.every((day) => day.ymd.startsWith("2026-10")), true);
  assert.equal(weeks[4]!.weekNumber, 5);
  assert.equal(weeks[4]!.clippedStartYmd, "2026-10-26");
  assert.equal(weeks[4]!.clippedEndYmd, "2026-10-31");
});

test("leap-year February 2024 keeps Feb 29 and a non-leap Monday February has four weeks", () => {
  const leap = clippedMonthWeeks(2024, 2);
  assert.equal(leap.length, 5);
  assert.equal(leap[leap.length - 1]!.clippedEndYmd, "2024-02-29");
  assert.equal(
    leap.some((week) => week.clippedDays.some((day) => day.ymd === "2024-02-29")),
    true,
  );

  const nonLeap = clippedMonthWeeks(2021, 2);
  assert.equal(nonLeap.length, 4);
  assert.equal(nonLeap[0]!.clippedStartYmd, "2021-02-01");
  assert.equal(nonLeap[0]!.clippedDays[0]!.weekday, "Monday");
  assert.equal(nonLeap[nonLeap.length - 1]!.clippedEndYmd, "2021-02-28");
});

test("a Sunday evening session past the current month stays on the current month row", () => {
  const trade = { tradeDate: "2026-05-31", tradedAt: "2026-05-31T22:30:00.000Z" };
  assert.equal(sessionYmdForTrade(trade), "2026-06-01");
  assert.equal(monthKeyForTrade(trade, "2026-05-31"), "2026-05");
  assert.deepEqual(spillSessionYmds([trade], "2026-05-31"), ["2026-06-01"]);
  assert.equal(monthKeyForTrade({ tradeDate: "2026-05-15" }, "2026-05-31"), "2026-05");
});

test("year-to-date months run January through the current New York month", () => {
  const months = ytdMonthsThrough(new Date("2026-10-06T15:00:00-04:00"));
  assert.equal(months[0]!.label, "January");
  assert.equal(months[0]!.key, "2026-01");
  assert.equal(months[months.length - 1]!.label, "October");
  assert.equal(months.length, 10);
});

function realizedSum(trades: readonly { realizedDollars?: number | null }[]): number {
  return Math.round(trades.reduce((sum, trade) => sum + (trade.realizedDollars ?? 0), 0) * 100) / 100;
}

test("week-of labels name the month once when the slice stays inside it", () => {
  assert.equal(formatWeekOfLabel("2026-01-05", "2026-01-11"), "Week of Jan 5\u201311");
  assert.equal(formatWeekOfLabel("2026-01-04", "2026-01-04"), "Week of Jan 4");
  assert.equal(formatWeekOfLabel("2025-12-29", "2026-01-04"), "Week of Dec 29\u2013Jan 4");
});

test("a month's week portions are that month's days only and still add up to the month", () => {
  const trades = [
    { id: "dec", tradeDate: "2025-12-31", realizedDollars: 10 },
    { id: "jan-early", tradeDate: "2026-01-02", realizedDollars: 20 },
    { id: "jan-mid", tradeDate: "2026-01-15", realizedDollars: 420.25 },
    { id: "sep", tradeDate: "2026-09-30", realizedDollars: 4 },
    { id: "oct", tradeDate: "2026-10-02", realizedDollars: 3 },
  ];
  const through = "2026-10-06";
  const december = monthWeekPortions(2025, 12, trades, through);
  const january = monthWeekPortions(2026, 1, trades, through);
  const october = monthWeekPortions(2026, 10, trades, through);

  assert.deepEqual(
    january.map((portion) => portion.label),
    ["Week of Jan 1\u20134", "Week of Jan 5\u201311", "Week of Jan 12\u201318", "Week of Jan 19\u201325", "Week of Jan 26\u201331"],
  );
  assert.equal(january.find((portion) => portion.trades.some((trade) => trade.id === "jan-early"))?.label, "Week of Jan 1\u20134");
  assert.equal(january.find((portion) => portion.trades.some((trade) => trade.id === "jan-mid"))?.label, "Week of Jan 12\u201318");
  assert.equal(january.some((portion) => portion.trades.length === 0), true);
  assert.equal(
    january.some((portion) => portion.trades.some((trade) => trade.id === "dec")),
    false,
  );

  const decemberTrade = december.find((portion) => portion.trades.some((trade) => trade.id === "dec"));
  assert.equal(decemberTrade?.label, "Week of Dec 29\u201331");
  assert.equal(
    december.some((portion) => portion.trades.some((trade) => trade.id === "jan-early")),
    false,
  );

  for (const [year, month, portions] of [
    [2025, 12, december],
    [2026, 1, january],
    [2026, 10, october],
  ] as const) {
    const monthKey = `${year}-${String(month).padStart(2, "0")}`;
    const owned = trades.filter((trade) => monthKeyForTrade(trade, through) === monthKey);
    const listed = portions.flatMap((portion) => portion.trades);
    assert.equal(listed.length, owned.length);
    assert.equal(realizedSum(listed), realizedSum(owned));
    const ids = listed.map((trade) => trade.id);
    assert.equal(new Set(ids).size, ids.length);
  }

  assert.deepEqual(
    october.find((portion) => portion.trades.length > 0)?.label,
    "Week of Oct 1\u20134",
  );
  assert.equal(
    october.some((portion) => portion.trades.some((trade) => trade.id === "sep")),
    false,
  );
});

test("a Sunday evening past the current month is a week headline on that month", () => {
  const trade = { id: "spill", tradeDate: "2026-05-31", tradedAt: "2026-05-31T22:30:00.000Z", realizedDollars: 7 };
  const throughMay = "2026-05-31";
  const may = monthWeekPortions(2026, 5, [trade], throughMay);
  const spill = may.find((portion) => portion.trades.some((row) => row.id === "spill"));
  assert.equal(spill?.label, "Week of Jun 1");
  assert.equal(may.length, clippedMonthWeeks(2026, 5).length + 1);
  assert.equal(realizedSum(may.flatMap((portion) => portion.trades)), 7);
  assert.equal(
    realizedSum(may.flatMap((portion) => portion.trades)),
    realizedSum([trade].filter((row) => monthKeyForTrade(row, throughMay) === "2026-05")),
  );

  const throughOctober = "2026-10-06";
  const mayLater = monthWeekPortions(2026, 5, [trade], throughOctober);
  assert.equal(mayLater.every((portion) => portion.trades.length === 0), true);
  const june = monthWeekPortions(2026, 6, [trade], throughOctober);
  assert.equal(june.find((portion) => portion.trades.length > 0)?.label, "Week of Jun 1\u20137");
  assert.equal(realizedSum(june.flatMap((portion) => portion.trades)), 7);
});
