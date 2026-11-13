import type Database from "better-sqlite3";

import { chooseCited, citedIsBlank } from "@/lib/screener/cited";
import { SCREENER_NAME } from "@/lib/screener/name";
import { screenerSeedMeta } from "@/lib/screener/seed";
import { ALPHA_VANTAGE_ENV, FINNHUB_ENV, FMP_ENV } from "@/lib/screener/fetchers";
import { FIELD_PRIORITY } from "@/lib/screener/sourcesMeta";
import { listObservations, listPresets, listSecurities, listWarEdits } from "@/lib/screener/store";
import type { Cited, CorrWindow, ScreenerPageData, ScreenerRow, SourceAvailability, StoredObservation } from "@/lib/screener/types";
import { CORR_WINDOWS, EMPTY_CITED } from "@/lib/screener/types";
import { getSchwabToken } from "@/lib/schwab/token";

function choose(observations: StoredObservation[], field: StoredObservation["field"], window?: CorrWindow): Cited {
  const matching = observations.filter((obs) => {
    if (obs.field !== field) return false;
    if (!window) return true;
    return obs.meta?.window === window;
  });
  return chooseCited(matching, FIELD_PRIORITY[field] ?? []);
}

function withVendorPeers(cited: Cited, own: StoredObservation[], field: StoredObservation["field"]): Cited {
  const extras = own.filter((obs) => obs.field === field && (obs.valueText || obs.valueNum != null));
  if (extras.length === 0) return cited;
  return {
    ...cited,
    peers: [
      ...cited.peers,
      ...extras.map((obs) => ({
        source: obs.source,
        valueNum: obs.valueNum ?? null,
        valueText: obs.valueText ?? null,
        asOf: obs.asOf ?? null,
        sourceUrl: obs.sourceUrl ?? null,
        relativeGap: null,
        otherClassification: true,
      })),
    ],
  };
}

function blankWindows(): Record<CorrWindow, Cited> {
  return { "3m": { ...EMPTY_CITED }, "1y": { ...EMPTY_CITED }, "3y": { ...EMPTY_CITED } };
}

function schwabReady(): SourceAvailability {
  const base = { id: "schwab", label: "Schwab marketdata fundamentals", env: "FINANCE_HUB_PASSPHRASE" };
  const passphrase = process.env.FINANCE_HUB_PASSPHRASE?.trim();
  if (!passphrase) return { ...base, state: "skipped", detail: "FINANCE_HUB_PASSPHRASE is not set, so Schwab is skipped." };
  try {
    if (!getSchwabToken(passphrase)) return { ...base, state: "skipped", detail: "Schwab is not connected." };
  } catch {
    return { ...base, state: "skipped", detail: "Schwab is not connected." };
  }
  return { ...base, state: "ready", detail: "Read-only instruments fundamental. No forward-named ratio is requested." };
}

function keyed(id: string, label: string, env: string, readyDetail: string): SourceAvailability {
  if (!process.env[env]?.trim()) return { id, label, env, state: "skipped", detail: `${env} is not set.` };
  return { id, label, env, state: "ready", detail: readyDetail };
}

export function sourceAvailability(): SourceAvailability[] {
  return [
    schwabReady(),
    { id: "yahoo", label: "Yahoo Finance (unofficial)", env: null, state: "ready", detail: "No API key. quoteSummary uses a crumb; chart adjusted closes do not." },
    keyed("finnhub", "Finnhub", FINNHUB_ENV, "Free tier, about 60 calls per minute. Metric ratios only."),
    keyed("fmp", "Financial Modeling Prep", FMP_ENV, "Free tier, about 250 calls per day, with a limited symbol list."),
    keyed("alphavantage", "Alpha Vantage", ALPHA_VANTAGE_ENV, "Free tier, 25 requests per day. OVERVIEW is marked premium; a free key may be refused."),
    { id: "sec", label: "SEC EDGAR companyfacts", env: null, state: "ready", detail: "No API key. Trailing revenue and diluted EPS from filed facts." },
  ];
}

export function loadScreenerPage(db: Database.Database, now = new Date().toISOString()): ScreenerPageData {
  const securities = listSecurities(db);
  const observations = listObservations(db);
  const byTicker = new Map<string, StoredObservation[]>();
  for (const obs of observations) {
    const list = byTicker.get(obs.ticker) ?? [];
    list.push(obs);
    byTicker.set(obs.ticker, list);
  }
  const edits = new Map(listWarEdits(db).map((edit) => [edit.ticker, edit]));
  const rows: ScreenerRow[] = securities.map((security) => {
    const own = byTicker.get(security.ticker) ?? [];
    const corrSpy = blankWindows();
    const corrQqq = blankWindows();
    for (const window of CORR_WINDOWS) {
      corrSpy[window] = choose(own, "corr_spy", window);
      corrQqq[window] = choose(own, "corr_qqq", window);
    }
    const war = choose(own, "war_exposure");
    const edit = edits.get(security.ticker);
    const gicsIndustry = choose(own, "industry");
    const industry = citedIsBlank(gicsIndustry) ? choose(own, "industry_vendor") : withVendorPeers(gicsIndustry, own, "industry_vendor");
    let warUnverified = war.meta?.unverified === true || war.meta?.reportUnverified === true || war.singleSource;
    let warShown = war;
    if (edit) {
      warUnverified = edit.unverified;
      if (edit.rating) {
        warShown = {
          ...war,
          valueText: edit.rating,
          source: "manual",
          asOf: edit.updatedAt.slice(0, 10),
          fetchedAt: edit.updatedAt,
          sourceUrl: edit.sourceUrl ?? war.sourceUrl,
          singleSource: true,
          meta: { ...(war.meta ?? {}), edited: true, priorSource: war.source, priorAsOf: war.asOf, priorValue: war.valueText },
        };
      } else if (edit.sourceUrl) {
        warShown = { ...war, sourceUrl: edit.sourceUrl };
      }
    }
    return {
      ticker: security.ticker,
      name: security.name,
      inSp500: security.inSp500,
      origin: security.origin,
      cik: security.cik,
      sector: withVendorPeers(choose(own, "gics_sector"), own, "sector_vendor"),
      industry,
      blurb: choose(own, "blurb"),
      marketCap: choose(own, "market_cap"),
      peTrailing: choose(own, "pe_trailing"),
      peForward: choose(own, "pe_forward"),
      peg: choose(own, "peg"),
      psTrailing: choose(own, "ps_trailing"),
      psForward: choose(own, "ps_forward"),
      peSchwab: choose(own, "pe_schwab"),
      revenueTtm: choose(own, "revenue_ttm"),
      epsTtm: choose(own, "eps_ttm"),
      corrSpy,
      corrQqq,
      war: warShown,
      warUnverified,
      warNote: typeof war.meta?.note === "string" ? war.meta.note : null,
      sizeRank: null,
    };
  });

  const ranked = rows
    .filter((row) => row.marketCap.valueNum != null)
    .sort((a, b) => b.marketCap.valueNum! - a.marketCap.valueNum! || a.ticker.localeCompare(b.ticker));
  ranked.forEach((row, index) => {
    row.sizeRank = index + 1;
  });
  rows.sort((a, b) => (a.sizeRank ?? 10_000) - (b.sizeRank ?? 10_000) || a.ticker.localeCompare(b.ticker));

  const seed = screenerSeedMeta();
  return {
    name: SCREENER_NAME,
    rows,
    presets: listPresets(db),
    sources: sourceAvailability(),
    universe: {
      ...seed,
      reportOnlyTickers: rows.filter((row) => row.origin === "report").map((row) => row.ticker),
    },
    generatedAt: now,
  };
}
