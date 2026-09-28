import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import {
  PortfolioSessionCloseHeadline,
  PortfolioSessionClosePlot,
} from "@/app/components/terminal/PortfolioSessionClosePlot";
import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";
import { resolveGlanceInstrumentId } from "@/lib/market/glanceMiniChartSession";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";
import { portfolioGlancePlot } from "@/lib/terminal/portfolioGlanceDisplay";

const portfolio: UsMarketGlanceItem = {
  id: "portfolio",
  label: "Portfolio",
  symbol: "PORT",
  last: 97.33,
  change: -2.67,
  changePct: -2.67,
  previousClose: 100,
  series: [
    { idx: 0, close: 100, tsMs: 1 },
    { idx: 1, close: 98.4, tsMs: 2 },
    { idx: 2, close: 97.33, tsMs: 3 },
  ],
  valueMode: "percent",
  netValue: 973_300,
  priorNetValue: 1_000_000,
  sessionClose: 97.33,
};

function at(iso: string): Date {
  return new Date(iso);
}

test("regular session keeps the portfolio on the live plot, same as cash indexes", () => {
  const now = at("2026-05-20T15:00:00.000Z"); // Wed 11:00 ET
  assert.equal(isUsEquityRegularSessionOpen(now), true);
  assert.equal(resolveGlanceInstrumentId("nasdaq", now), "nasdaq");
  assert.equal(resolveGlanceInstrumentId("sp500", now), "sp500");
  const plot = portfolioGlancePlot({
    now,
    item: portfolio,
    displayMode: "indexed",
    balanceUnlocked: false,
  });
  assert.deepEqual(plot, { mode: "live" });
});

test("09:30 ET open returns the portfolio to the live plot", () => {
  const now = at("2026-05-18T13:30:00.000Z"); // Mon 09:30 ET
  assert.equal(isUsEquityRegularSessionOpen(now), true);
  assert.equal(resolveGlanceInstrumentId("nasdaq", now), "nasdaq");
  const plot = portfolioGlancePlot({
    now,
    item: portfolio,
    displayMode: "indexed",
    balanceUnlocked: true,
  });
  assert.deepEqual(plot, { mode: "live" });
});

test("15:59 ET is still the live plot", () => {
  const now = at("2026-05-20T19:59:00.000Z"); // Wed 15:59 ET
  assert.equal(isUsEquityRegularSessionOpen(now), true);
  assert.equal(resolveGlanceInstrumentId("russell2000", now), "russell2000");
  const plot = portfolioGlancePlot({
    now,
    item: portfolio,
    displayMode: "dollar",
    balanceUnlocked: true,
  });
  assert.deepEqual(plot, { mode: "live" });
});

test("after the 16:00 ET close the portfolio drops its series and holds the session close", () => {
  const now = at("2026-05-20T20:00:30.000Z"); // Wed 16:00:30 ET
  assert.equal(isUsEquityRegularSessionOpen(now), false);
  assert.equal(resolveGlanceInstrumentId("nasdaq", now), "us-nq");
  assert.equal(resolveGlanceInstrumentId("sp500", now), "us-es");
  const plot = portfolioGlancePlot({
    now,
    item: portfolio,
    displayMode: "indexed",
    balanceUnlocked: false,
  });
  assert.equal(plot.mode, "session_close");
  if (plot.mode !== "session_close") return;
  assert.deepEqual(plot.series, []);
  assert.equal(plot.referencePrice, 97.33);
  assert.equal(plot.shownReferencePrice, 97.33);
  assert.equal(plot.headlineValue, 97.33);
  assert.equal(plot.headlineKind, "index");
  assert.equal(plot.headlineLabel, "Previous close");
  assert.equal(plot.changePct, -2.67);
  assert.equal(plot.changeLabel, "At close");
  assert.ok(portfolio.series.length >= 2);
});

test("pre-open Monday uses the session close, same as the futures proxy", () => {
  const now = at("2026-05-18T13:00:00.000Z"); // Mon 09:00 ET
  assert.equal(isUsEquityRegularSessionOpen(now), false);
  assert.equal(resolveGlanceInstrumentId("nasdaq", now), "us-nq");
  const plot = portfolioGlancePlot({
    now,
    item: portfolio,
    displayMode: "indexed",
    balanceUnlocked: false,
  });
  assert.equal(plot.mode, "session_close");
  if (plot.mode !== "session_close") return;
  assert.deepEqual(plot.series, []);
  assert.equal(plot.referencePrice, 97.33);
  assert.equal(plot.shownReferencePrice, plot.headlineValue);
  assert.equal(plot.headlineValue, plot.referencePrice);
  assert.equal(plot.headlineLabel, "Previous close");
  assert.equal(plot.changeLabel, "At close");
});

test("weekend uses the session close, same as the futures proxy", () => {
  const now = at("2026-05-23T16:00:00.000Z"); // Sat 12:00 ET
  assert.equal(isUsEquityRegularSessionOpen(now), false);
  assert.equal(resolveGlanceInstrumentId("sp500", now), "us-es");
  const plot = portfolioGlancePlot({
    now,
    item: portfolio,
    displayMode: "indexed",
    balanceUnlocked: false,
  });
  assert.equal(plot.mode, "session_close");
  if (plot.mode !== "session_close") return;
  assert.deepEqual(plot.series, []);
  assert.equal(plot.referencePrice, 97.33);
  assert.equal(plot.shownReferencePrice, plot.referencePrice);
  assert.equal(plot.headlineValue, plot.referencePrice);
  assert.equal(plot.headlineLabel, "Previous close");
  assert.equal(plot.changePct, -2.67);
  assert.equal(plot.changeLabel, "At close");
});

test("dollar mode headline is the close balance when unlocked, and stays masked when locked", () => {
  const now = at("2026-05-20T20:00:30.000Z");
  const unlocked = portfolioGlancePlot({
    now,
    item: portfolio,
    displayMode: "dollar",
    balanceUnlocked: true,
  });
  assert.equal(unlocked.mode, "session_close");
  if (unlocked.mode !== "session_close") return;
  assert.deepEqual(unlocked.series, []);
  assert.equal(unlocked.referencePrice, 973_300);
  assert.equal(unlocked.shownReferencePrice, 973_300);
  assert.equal(unlocked.headlineValue, 973_300);
  assert.equal(unlocked.headlineKind, "dollars");
  assert.equal(unlocked.headlineLabel, "Previous close");
  assert.equal(unlocked.changeLabel, "At close");

  const locked = portfolioGlancePlot({
    now,
    item: portfolio,
    displayMode: "dollar",
    balanceUnlocked: false,
  });
  assert.equal(locked.mode, "session_close");
  if (locked.mode !== "session_close") return;
  assert.equal(locked.headlineKind, "masked");
  assert.equal(locked.headlineValue, null);
  assert.equal(locked.headlineLabel, "Previous close");
  assert.equal(locked.referencePrice, 973_300);
  assert.equal(locked.shownReferencePrice, null);
  assert.equal(locked.changePct, -2.67);
  assert.equal(locked.changeLabel, "At close");
  const lockedHtml = renderToStaticMarkup(
    createElement(PortfolioSessionClosePlot, { referencePrice: locked.shownReferencePrice }),
  );
  assert.match(lockedHtml, /data-portfolio-mark="reference"/);
  assert.equal(lockedHtml.includes("973300"), false);
});

test("closed render path draws the previous-close line and no portfolio series", () => {
  const now = at("2026-05-20T20:00:30.000Z");
  const plot = portfolioGlancePlot({
    now,
    item: portfolio,
    displayMode: "indexed",
    balanceUnlocked: false,
  });
  assert.equal(plot.mode, "session_close");
  if (plot.mode !== "session_close") return;
  assert.deepEqual(plot.series, []);

  assert.equal(plot.headlineValue, plot.referencePrice);
  const html = renderToStaticMarkup(
    createElement(
      "div",
      null,
      createElement(
        PortfolioSessionCloseHeadline,
        { label: plot.headlineLabel },
        plot.headlineValue == null ? null : plot.headlineValue.toFixed(2),
      ),
      createElement(PortfolioSessionClosePlot, { referencePrice: plot.shownReferencePrice }),
    ),
  );
  assert.match(html, /data-portfolio-plot="session-close"/);
  assert.match(html, /data-portfolio-mark="reference"/);
  assert.match(html, /data-reference-price="97.33"/);
  assert.match(html, />Previous close</);
  assert.match(html, />97\.33</);
  assert.equal(html.includes('data-portfolio-mark="series"'), false);
  assert.equal(html.includes("<path"), false);
  assert.equal(html.includes("Previous close 97.33"), true);
});

test("a benchmark id does not enter the portfolio session-close plot", () => {
  const plot = portfolioGlancePlot({
    now: at("2026-05-23T16:00:00.000Z"),
    item: { ...portfolio, id: "nasdaq", label: "Nasdaq 100 E-mini" },
    displayMode: "indexed",
    balanceUnlocked: false,
  });
  assert.deepEqual(plot, { mode: "live" });
});
