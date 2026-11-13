import type Database from "better-sqlite3";

import reportsJson from "@/lib/screener/seed/reports.json";
import sp500Json from "@/lib/screener/seed/sp500.json";
import { BUILTIN_PRESETS } from "@/lib/screener/presets";
import { REPORT_AS_OF, REPORT_PREPARED_AT, REPORT_SOURCE, WIKI_SOURCE } from "@/lib/screener/sourcesMeta";
import type { ReportCompany } from "@/lib/screener/parseReports";
import { savePreset, upsertObservation, upsertSecurity } from "@/lib/screener/store";

type SpRow = {
  ticker: string;
  wikiSymbol: string;
  name: string | null;
  gicsSector: string | null;
  gicsSubIndustry: string | null;
  cik: number | null;
};

const reports = reportsJson as { companies: ReportCompany[] };
const sp500 = sp500Json as {
  meta: {
    revisionTimestamp: string;
    url: string;
    revisionUrl: string;
    retrievedOn: string;
    count: number;
  };
  constituents: SpRow[];
};

export function screenerSeedMeta() {
  return {
    sp500Count: sp500.meta.count,
    sp500Url: sp500.meta.url,
    sp500RevisionUrl: sp500.meta.revisionUrl,
    sp500RevisionTimestamp: sp500.meta.revisionTimestamp,
    sp500RetrievedOn: sp500.meta.retrievedOn,
    figuresAsOf: REPORT_AS_OF,
    figuresAsOfDetail: "Nov 12, 2026 stock-market close (4:00 p.m. ET)",
  };
}

/** Idempotent. Report and Wikipedia rows are refreshed from the checked-in seed. User rows and manual edits stay. */
export function seedScreener(db: Database.Database): void {
  const reportByTicker = new Map(reports.companies.map((row) => [row.ticker, row]));
  const wikiAsOf = sp500.meta.revisionTimestamp.slice(0, 10);
  const tx = db.transaction(() => {
    for (const row of sp500.constituents) {
      const report = reportByTicker.get(row.ticker);
      upsertSecurity(
        db,
        {
          ticker: row.ticker,
          name: report?.name ?? row.name,
          inSp500: true,
          origin: "sp500",
          cik: row.cik ?? report?.cik ?? null,
          wikiSymbol: row.wikiSymbol,
        },
        REPORT_PREPARED_AT,
      );
      if (row.gicsSector) {
        upsertObservation(
          db,
          row.ticker,
          {
            field: "gics_sector",
            source: WIKI_SOURCE,
            valueText: row.gicsSector,
            asOf: wikiAsOf,
            sourceUrl: sp500.meta.revisionUrl,
            meta: { classification: "GICS", retrievedOn: sp500.meta.retrievedOn, wikiSymbol: row.wikiSymbol },
          },
          sp500.meta.retrievedOn,
        );
      }
      if (row.gicsSubIndustry) {
        upsertObservation(
          db,
          row.ticker,
          {
            field: "industry",
            source: WIKI_SOURCE,
            valueText: row.gicsSubIndustry,
            asOf: wikiAsOf,
            sourceUrl: sp500.meta.revisionUrl,
            meta: { classification: "GICS", level: "sub-industry", retrievedOn: sp500.meta.retrievedOn },
          },
          sp500.meta.retrievedOn,
        );
      }
    }

    for (const row of reports.companies) {
      const inSp500 = sp500.constituents.some((item) => item.ticker === row.ticker);
      upsertSecurity(
        db,
        {
          ticker: row.ticker,
          name: row.name,
          inSp500,
          origin: inSp500 ? "sp500" : "report",
          cik: row.cik,
          wikiSymbol: row.ticker.includes("-") ? row.ticker.replace(/-/g, ".") : row.ticker,
        },
        REPORT_PREPARED_AT,
      );
      const reportMeta = {
        reports: row.sources,
        shareClassesCombined: row.shareClassesCombined,
        marketCapText: row.marketCapText,
        rankTop50: row.rankTop50,
        sectorRank: row.sectorRank,
      };
      upsertObservation(
        db,
        row.ticker,
        {
          field: "gics_sector",
          source: REPORT_SOURCE,
          valueText: row.sector,
          asOf: REPORT_AS_OF,
          meta: { ...reportMeta, classification: "GICS" },
        },
        REPORT_PREPARED_AT,
      );
      upsertObservation(
        db,
        row.ticker,
        {
          field: "blurb",
          source: REPORT_SOURCE,
          valueText: row.blurb,
          asOf: REPORT_AS_OF,
          meta: { reports: row.sources },
        },
        REPORT_PREPARED_AT,
      );
      upsertObservation(
        db,
        row.ticker,
        {
          field: "market_cap",
          source: REPORT_SOURCE,
          valueNum: row.marketCapUsd,
          asOf: REPORT_AS_OF,
          meta: reportMeta,
        },
        REPORT_PREPARED_AT,
      );
      const corrMeta = {
        window: row.corrWindow,
        shortHistory: row.corrShortHistory,
        historyNote: row.corrHistoryNote,
        priceSource: "Yahoo Finance, as stated in the report",
        method: "Pearson correlation of daily returns",
        reports: row.sources,
      };
      upsertObservation(
        db,
        row.ticker,
        { field: "corr_spy", source: REPORT_SOURCE, valueNum: row.corrSpy, asOf: REPORT_AS_OF, meta: corrMeta },
        REPORT_PREPARED_AT,
      );
      upsertObservation(
        db,
        row.ticker,
        { field: "corr_qqq", source: REPORT_SOURCE, valueNum: row.corrQqq, asOf: REPORT_AS_OF, meta: corrMeta },
        REPORT_PREPARED_AT,
      );
      upsertObservation(
        db,
        row.ticker,
        {
          field: "war_exposure",
          source: REPORT_SOURCE,
          valueText: row.warExposure,
          asOf: REPORT_AS_OF,
          sourceUrl: row.warSourceUrl,
          meta: {
            reports: row.sources,
            note: row.warNote,
            reportUnverified: row.warReportUnverified,
            unverified: true,
            filingCik: row.cik,
          },
        },
        REPORT_PREPARED_AT,
      );
    }

    for (const preset of BUILTIN_PRESETS) {
      savePreset(db, { ...preset, builtIn: true }, REPORT_PREPARED_AT);
    }
  });
  tx();
}
