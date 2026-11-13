import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import Database from "better-sqlite3";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { ScreenerScreen } from "@/app/screener/ScreenerScreen";
import { correlationBand, marketCapBand } from "@/lib/screener/bands";
import { chooseCited, DISAGREEMENT_THRESHOLD, relativeGap } from "@/lib/screener/cited";
import { correlationForWindow, pearson } from "@/lib/screener/correlation";
import { applyFilters, EMPTY_FILTERS, matchRow } from "@/lib/screener/filter";
import { parseYahooQuoteSummary, parseSchwabFundamentals } from "@/lib/screener/parseLive";
import { parseReportTexts } from "@/lib/screener/parseReports";
import { parseSp500Wikitext } from "@/lib/screener/parseWikipedia";
import { BUILTIN_PRESETS } from "@/lib/screener/presets";
import { refreshScreener } from "@/lib/screener/refresh";
import { trailingFromFacts } from "@/lib/screener/secTtm";
import { seedScreener } from "@/lib/screener/seed";
import reportsJson from "@/lib/screener/seed/reports.json";
import sp500Json from "@/lib/screener/seed/sp500.json";
import { ensureScreenerSchema } from "@/lib/screener/store";
import type { ScreenerPageData, ScreenerRow, StoredObservation } from "@/lib/screener/types";
import { EMPTY_CITED } from "@/lib/screener/types";
import { pullFinnhub, pullFmp, pullAlphaVantage } from "@/lib/screener/fetchers";
import { loadScreenerPage } from "@/lib/screener/view";

const fixtureDir = path.join(path.dirname(fileURLToPath(import.meta.url)), "fixtures");

function memoryDb() {
  const db = new Database(":memory:");
  ensureScreenerSchema(db);
  seedScreener(db);
  return db;
}

function row(partial: Partial<ScreenerRow> & Pick<ScreenerRow, "ticker">): ScreenerRow {
  const blank = () => ({ ...EMPTY_CITED, peers: [] });
  return {
    name: partial.ticker,
    inSp500: true,
    origin: "sp500",
    cik: null,
    sector: blank(),
    industry: blank(),
    blurb: blank(),
    marketCap: blank(),
    peTrailing: blank(),
    peForward: blank(),
    peg: blank(),
    psTrailing: blank(),
    psForward: blank(),
    peSchwab: blank(),
    revenueTtm: blank(),
    epsTtm: blank(),
    corrSpy: { "3m": blank(), "1y": blank(), "3y": blank() },
    corrQqq: { "3m": blank(), "1y": blank(), "3y": blank() },
    war: blank(),
    warUnverified: false,
    warNote: null,
    sizeRank: null,
    ...partial,
  };
}

function citedNum(value: number, source = "yahoo"): ScreenerRow["peTrailing"] {
  return { ...EMPTY_CITED, valueNum: value, source, asOf: "2026-11-12", singleSource: true, peers: [] };
}

test("report parser matches the checked-in seed", () => {
  const parsed = parseReportTexts(readFileSync(path.join(fixtureDir, "top50.txt"), "utf8"), readFileSync(path.join(fixtureDir, "top3.txt"), "utf8"));
  const companies = (reportsJson as { companies: typeof parsed }).companies;
  assert.equal(parsed.length, 60);
  assert.equal(companies.length, 60);
  assert.deepEqual(parsed, companies);
  const aapl = parsed.find((item) => item.ticker === "AAPL");
  assert.equal(aapl?.marketCapUsd, 5_157_000_000_000);
  assert.equal(aapl?.corrSpy, 0.34);
  assert.equal(aapl?.warExposure, "High");
  assert.equal(aapl?.warSourceUrl.includes("sec.gov"), true);
  const spcx = parsed.find((item) => item.ticker === "SPCX");
  assert.equal(spcx?.corrShortHistory, true);
  assert.equal(spcx?.corrHistoryNote, "106 trading days from Jun 15, 2026.");
  assert.equal(parsed.find((item) => item.ticker === "IBM")?.warExposure, "n/a");
  assert.deepEqual(
    parsed.filter((item) => item.sources.length === 1 && item.sources[0] === "report:top3_by_sector").map((item) => item.ticker),
    ["COP", "LIN", "NEM", "FCX", "NEE", "SO", "DUK", "WELL", "PLD", "EQIX"],
  );
  assert.equal(parsed.find((item) => item.ticker === "GOOGL")?.shareClassesCombined, true);
  assert.equal(parsed.find((item) => item.ticker === "DELL")?.corrQqq, 0.5);
});

test("Wikipedia constituent parser keeps Cboe, class shares, and a CIK glued to the founded year", () => {
  const text = `
{| id="constituents"
|-
|| {{NyseSymbol|BRK.B}} <!-- keep BRK.B -->
|| [[Berkshire Hathaway]]
|| Financials
|| Multi-Sector Holdings
|| [[Omaha, Nebraska]]
|| 2010-02-16
|| 0001067983
|| 1839
|-
|| {{NasdaqSymbol|AAPL}}
|| [[Apple Inc.]]
|| Information Technology
|| Technology Hardware, Storage & Peripherals
|| [[Cupertino, California]]
|| 1982-11-30
|| 0000320193
|1977
|-
|| {{BZX link|CBOE}}
|| [[Cboe Global Markets]]
|| Financials
|| Financial Exchanges & Data
|| [[Chicago]], Illinois
|| 2017-03-01
|| 0001374310
|| 1973
|}`;
  const rows = parseSp500Wikitext(text);
  assert.deepEqual(rows.map((item) => item.ticker), ["BRK-B", "AAPL", "CBOE"]);
  assert.equal(rows[0]?.wikiSymbol, "BRK.B");
  assert.equal(rows[0]?.gicsSector, "Financials");
  assert.equal(rows[1]?.cik, 320193);
  assert.equal(rows[2]?.gicsSubIndustry, "Financial Exchanges & Data");
  const seeded = sp500Json as { meta: { count: number; revisionId: number }; constituents: Array<{ ticker: string; cik: number | null; gicsSector: string }> };
  assert.equal(seeded.meta.count, 503);
  assert.equal(seeded.meta.revisionId, 1384572480);
  assert.equal(seeded.constituents.length, 503);
  assert.equal(seeded.constituents.find((item) => item.ticker === "AAPL")?.gicsSector, "Information Technology");
  assert.equal(seeded.constituents.find((item) => item.ticker === "CBOE")?.cik, 1374310);
  assert.equal(seeded.constituents.some((item) => item.cik == null), false);
});

test("SEC trailing figures sum four quarters or bridge a fiscal year", () => {
  const summed = trailingFromFacts(
    [
      { start: "2024-01-01", end: "2024-03-31", val: 10, form: "10-Q", filed: "2024-05-01" },
      { start: "2024-04-01", end: "2024-06-30", val: 20, form: "10-Q", filed: "2024-08-01" },
      { start: "2024-07-01", end: "2024-09-30", val: 30, form: "10-Q", filed: "2024-11-01" },
      { start: "2024-10-01", end: "2024-12-31", val: 40, form: "10-Q", filed: "2025-02-01" },
    ],
    "Revenues",
  );
  assert.equal(summed?.method, "four-quarters");
  assert.equal(summed?.value, 100);
  const bridged = trailingFromFacts(
    [
      { start: "2024-01-01", end: "2024-12-31", val: 100, form: "10-K", filed: "2025-02-01" },
      { start: "2024-01-01", end: "2024-09-30", val: 70, form: "10-Q", filed: "2024-11-01" },
      { start: "2025-01-01", end: "2025-09-30", val: 80, form: "10-Q", filed: "2025-11-01" },
    ],
    "Revenues",
  );
  assert.equal(bridged?.method, "fy-plus-ytd");
  assert.equal(bridged?.value, 110);
  assert.equal(bridged?.asOf, "2025-09-30");
  assert.equal(trailingFromFacts([{ start: "2025-01-01", end: "2025-03-31", val: 10, form: "10-Q" }], "Revenues"), null);
});

test("correlation, bands, and the 5% disagreement flag", () => {
  const stock = [1, 2, 4, 8].map((adjClose, index) => ({ date: `2026-01-0${index + 1}`, adjClose }));
  const bench = [2, 4, 8, 16].map((adjClose, index) => ({ date: `2026-01-0${index + 1}`, adjClose }));
  assert.equal(pearson([0.1, 0.2, 0.3], [0.1, 0.2, 0.3]), 1);
  const perfect = correlationForWindow(
    Array.from({ length: 30 }, (_, index) => ({ date: `2024-01-${String(index + 1).padStart(2, "0")}`, adjClose: index + 1 })),
    Array.from({ length: 30 }, (_, index) => ({ date: `2024-01-${String(index + 1).padStart(2, "0")}`, adjClose: (index + 1) * 2 })),
    "1y",
  );
  assert.ok(perfect);
  assert.equal(perfect?.shortHistory, true);
  assert.ok((perfect?.pairedReturns ?? 0) < 251);
  assert.equal(correlationBand(perfect!.value), "H");
  assert.equal(correlationForWindow(stock.slice(0, 3), bench.slice(0, 3), "3m"), null);
  assert.equal(correlationBand(0.5), "H");
  assert.equal(correlationBand(0.499), "M");
  assert.equal(correlationBand(0.25), "M");
  assert.equal(correlationBand(0.249), "L");
  assert.equal(correlationBand(-0.5), "H");
  assert.equal(correlationBand(-0.1), "L");
  assert.equal(marketCapBand(5_157_000_000_000), "mega");
  assert.equal(marketCapBand(9e9), "mid");
  assert.ok(relativeGap(10, 10.4) <= DISAGREEMENT_THRESHOLD);
  assert.ok(relativeGap(10, 10.6) > DISAGREEMENT_THRESHOLD);
  const observations: StoredObservation[] = [
    { ticker: "AAPL", field: "pe_trailing", source: "yahoo_computed", valueNum: 10, asOf: "2026-11-12", fetchedAt: "2026-11-13", sourceUrl: null, meta: null },
    { ticker: "AAPL", field: "pe_trailing", source: "finnhub", valueNum: 10.6, asOf: "2026-11-12", fetchedAt: "2026-11-13", sourceUrl: null, meta: null },
  ];
  const cited = chooseCited(observations, ["yahoo_computed", "finnhub"]);
  assert.equal(cited.valueNum, 10);
  assert.equal(cited.disagreement, true);
  assert.equal(cited.singleSource, false);
  const alone = chooseCited([observations[0]!], ["yahoo_computed"]);
  assert.equal(alone.singleSource, true);
  assert.equal(alone.disagreement, false);
});

test("filters reject blanks and honor the built-in screens", () => {
  const low = row({
    ticker: "LOW",
    peg: citedNum(1.2),
    war: { ...EMPTY_CITED, valueText: "Low", source: "report", asOf: "2026-11-12", peers: [] },
    marketCap: citedNum(50e9),
    sizeRank: 40,
    corrQqq: { "3m": { ...EMPTY_CITED, peers: [] }, "1y": citedNum(0.1), "3y": { ...EMPTY_CITED, peers: [] } },
  });
  const high = row({
    ticker: "HIGH",
    peg: citedNum(1.5),
    war: { ...EMPTY_CITED, valueText: "High", source: "report", asOf: "2026-11-12", peers: [] },
    sizeRank: 2,
    corrQqq: { "3m": { ...EMPTY_CITED, peers: [] }, "1y": citedNum(0.8), "3y": { ...EMPTY_CITED, peers: [] } },
  });
  const blankPeg = row({
    ticker: "BLANK",
    war: { ...EMPTY_CITED, valueText: "Low", source: "report", asOf: "2026-11-12", peers: [] },
  });
  const pegScreen = BUILTIN_PRESETS[0]!.filters;
  assert.equal(matchRow(low, pegScreen).ok, true);
  assert.match(matchRow(low, pegScreen).reasons.join(" "), /PEG/);
  assert.equal(matchRow(high, pegScreen).ok, false);
  assert.equal(matchRow(blankPeg, pegScreen).ok, false);
  const qqqScreen = BUILTIN_PRESETS[1]!.filters;
  assert.equal(matchRow(low, qqqScreen).ok, true);
  assert.match(matchRow(low, qqqScreen).reasons.join(" "), /QQQ/);
  assert.equal(matchRow(high, qqqScreen).ok, false);
  assert.equal(matchRow(blankPeg, { ...EMPTY_FILTERS, sectors: ["Information Technology"] }).ok, false);
});

test("refresh falls back when a source throws and leaves seed figures in place", async () => {
  const db = memoryDb();
  const before = loadScreenerPage(db).rows.find((item) => item.ticker === "AAPL");
  assert.equal(before?.marketCap.valueNum, 5_157_000_000_000);
  assert.equal(before?.peForward.valueNum, null);
  const report = await refreshScreener(db, ["AAPL"], {
    fundamentals: async () => {
      throw new Error("boom");
    },
    adjustedCloses: async () => {
      throw new Error("no prices");
    },
  });
  assert.equal(report.refreshed.includes("AAPL"), true);
  assert.equal(report.attempts.some((attempt) => attempt.status === "failed"), true);
  const after = loadScreenerPage(db).rows.find((item) => item.ticker === "AAPL");
  assert.equal(after?.marketCap.valueNum, 5_157_000_000_000);
  assert.equal(after?.peForward.valueNum, null);

  await refreshScreener(db, ["AAPL"], {
    fundamentals: async () => [
      { source: "schwab", status: "failed", detail: "down", observations: [] },
      {
        source: "yahoo",
        status: "ok",
        observations: [{ field: "pe_forward", source: "yahoo", valueNum: 33.65, asOf: "2026-11-12", meta: { estimate: true } }],
      },
    ],
    adjustedCloses: async () => null,
  });
  const withForward = loadScreenerPage(db).rows.find((item) => item.ticker === "AAPL");
  assert.equal(withForward?.peForward.valueNum, 33.65);
  assert.equal(withForward?.peForward.source, "yahoo");
  assert.equal(withForward?.peForward.asOf, "2026-11-12");
  assert.equal(withForward?.marketCap.source, "report:2026-11-12-close");
});

test("keyed sources skip cleanly when the env var is missing", async () => {
  const db = memoryDb();
  const saved = {
    finnhub: process.env.FINNHUB_API_KEY,
    fmp: process.env.FMP_API_KEY,
    av: process.env.ALPHA_VANTAGE_API_KEY,
  };
  delete process.env.FINNHUB_API_KEY;
  delete process.env.FMP_API_KEY;
  delete process.env.ALPHA_VANTAGE_API_KEY;
  try {
    const finnhub = await pullFinnhub(db, "AAPL");
    const fmp = await pullFmp(db, "AAPL");
    const av = await pullAlphaVantage(db, "AAPL");
    assert.equal(finnhub.status, "skipped");
    assert.match(finnhub.detail ?? "", /FINNHUB_API_KEY/);
    assert.equal(fmp.status, "skipped");
    assert.match(fmp.detail ?? "", /FMP_API_KEY/);
    assert.equal(av.status, "skipped");
    assert.match(av.detail ?? "", /ALPHA_VANTAGE_API_KEY/);
    assert.equal(finnhub.observations.length, 0);
  } finally {
    if (saved.finnhub) process.env.FINNHUB_API_KEY = saved.finnhub;
    if (saved.fmp) process.env.FMP_API_KEY = saved.fmp;
    if (saved.av) process.env.ALPHA_VANTAGE_API_KEY = saved.av;
  }
});

test("Schwab peRatio is not labeled trailing or forward, and Yahoo forward P/E is a consensus field", () => {
  const schwab = parseSchwabFundamentals(
    {
      symbol: "AAPL",
      companyName: "Apple",
      sector: "Information Technology",
      industry: "Hardware",
      marketCap: 100,
      pe: null,
      divYield: null,
      beta: null,
      week52High: null,
      week52Low: null,
      avgVol: null,
      raw: { peRatio: 28, pegRatio: 1.4, prRatio: 9, epsTTM: 7, marketCap: 100 },
    },
    "2026-11-13T00:00:00.000Z",
  );
  assert.equal(schwab.some((item) => item.field === "pe_forward" || item.field === "pe_trailing"), false);
  assert.equal(schwab.find((item) => item.field === "pe_schwab")?.valueNum, 28);
  assert.equal(schwab.find((item) => item.field === "ps_trailing")?.valueNum, 9);
  const yahoo = parseYahooQuoteSummary(
    {
      quoteSummary: {
        result: [
          {
            price: { regularMarketPrice: { raw: 100 }, regularMarketTime: { raw: 1794517201 }, marketCap: { raw: 1000 } },
            defaultKeyStatistics: { forwardPE: { raw: 20 }, pegRatio: { raw: 1.1 }, trailingEps: { raw: 5 } },
            earningsTrend: { trend: [{ period: "0y", revenueEstimate: { avg: { raw: 200 }, numberOfAnalysts: { raw: 12 } } }] },
          },
        ],
      },
    },
    "2026-11-13T00:00:00.000Z",
  );
  assert.equal(yahoo.find((item) => item.field === "pe_forward")?.meta?.estimate, true);
  assert.equal(yahoo.some((item) => item.field === "pe_trailing" && item.source === "yahoo"), false);
  assert.equal(yahoo.find((item) => item.source === "yahoo_computed" && item.field === "pe_trailing")?.valueNum, 20);
  assert.equal(yahoo.find((item) => item.field === "ps_forward")?.valueNum, 5);
});

test("seeded page renders cited figures and leaves unsourced ratios blank", () => {
  const db = memoryDb();
  const page = loadScreenerPage(db);
  assert.equal(page.sources.find((source) => source.id === "finnhub")?.state, process.env.FINNHUB_API_KEY ? "ready" : "skipped");
  const aapl = page.rows.find((item) => item.ticker === "AAPL");
  assert.ok(aapl);
  assert.equal(aapl?.marketCap.asOf, "2026-11-12");
  assert.equal(aapl?.marketCap.source, "report:2026-11-12-close");
  assert.equal(aapl?.peTrailing.valueNum, null);
  assert.equal(aapl?.peForward.valueNum, null);
  assert.equal(aapl?.sector.valueText, "Information Technology");
  assert.equal(aapl?.sector.singleSource, false);
  assert.equal(aapl?.corrQqq["1y"].valueNum, 0.22);
  assert.equal(aapl?.war.valueText, "High");
  assert.equal(aapl?.warUnverified, true);
  const html = renderToStaticMarkup(createElement(ScreenerScreen, { initial: page }));
  assert.match(html, /Screener/);
  assert.match(html, /AAPL/);
  assert.match(html, /\$5\.157T/);
  assert.match(html, /—/);
  assert.match(html, /Nov 12, 2026/);
});

test("filtered seed rows include AAPL on the low-QQQ screen and render that name", () => {
  const db = memoryDb();
  const page = loadScreenerPage(db);
  const shown = applyFilters(page.rows, BUILTIN_PRESETS[1]!.filters);
  assert.equal(shown.some((item) => item.ticker === "AAPL"), true);
  assert.equal(shown.some((item) => item.ticker === "NVDA"), false);
  const markup = renderRowSummary(page);
  assert.match(markup, /AAPL/);
  assert.match(markup, /\$5\.157T/);
  assert.match(markup, /—/);
});

function renderRowSummary(page: ScreenerPageData): string {
  const aapl = page.rows.find((item) => item.ticker === "AAPL");
  return renderToStaticMarkup(
    createElement(
      "table",
      null,
      createElement(
        "tbody",
        null,
        createElement(
          "tr",
          null,
          createElement("td", null, page.name),
          createElement("td", null, aapl?.ticker),
          createElement("td", null, aapl?.marketCap.meta && typeof aapl.marketCap.meta.marketCapText === "string" ? aapl.marketCap.meta.marketCapText : ""),
          createElement("td", null, aapl?.peForward.valueNum == null ? "—" : String(aapl.peForward.valueNum)),
          createElement("td", null, aapl?.marketCap.source),
          createElement("td", null, aapl?.marketCap.asOf),
        ),
      ),
    ),
  );
}
