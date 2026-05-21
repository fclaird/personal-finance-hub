"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { useEffect, useMemo, useState } from "react";

import { useSchwabRefreshCoordinator } from "@/hooks/useSchwabRefreshCoordinator";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import type { Row } from "@/app/components/PositionsGroupedTable";
import { SymbolLink } from "@/app/components/SymbolLink";

import { SymbolNotesSection } from "./SymbolNotesSection";
import { formatInt, formatNum, formatOptionIntExtPerShare, formatUsd2 } from "@/lib/format";
import { formatDisplayDate } from "@/lib/formatDate";
import { formatOptionSymbolDisplay } from "@/lib/formatOptionDisplay";
import { symbolPageTargetFromInstrument } from "@/lib/symbolPage";
import { posNegClass, priceDirClass } from "@/lib/terminal/colors";

type NormalizedQuote = {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  close: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
  week52High: number | null;
  week52Low: number | null;
  updatedAt: string;
};

function usd2Unmasked(v: number) {
  return formatUsd2(v, { mask: false });
}

function syntheticSharesForRow(r: Row): number | null {
  if (r.securityType !== "option") return null;
  const d = typeof r.delta === "number" && Number.isFinite(r.delta) ? r.delta : 0;
  return r.quantity * 100 * d;
}

type CompanyPayload =
  | {
      ok: true;
      symbol: string;
      companyName: string | null;
      sector: string | null;
      industry: string | null;
      marketCap: number | null;
      pe: number | null;
      divYield: number | null;
      beta: number | null;
      week52High: number | null;
      week52Low: number | null;
      avgVol: number | null;
    }
  | { ok: false; error: string };

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const USD_COMPACT = new Intl.NumberFormat(undefined, { notation: "compact", maximumFractionDigits: 1 });

function usd2Masked(v: number, masked: boolean) {
  return formatUsd2(v, { mask: masked });
}

function normSym(s: string) {
  return (s ?? "").trim().toUpperCase();
}

type SymbolStoryPayload = {
  ok: boolean;
  businessSummary?: string;
  sources?: string[];
  secFilingSummary?: string | null;
  secForm?: string | null;
  secFilingDate?: string | null;
  secDocumentUrl?: string | null;
  yahooProfileUrl?: string | null;
  error?: string;
};

function openSourceAttribution(sources: string[]): string[] {
  return sources.filter((s) => !/\(EDGAR\)/i.test(s) && !/^SEC\s+\d/i.test(s));
}

type AboutState = {
  text: string;
  sources: string[];
  yahooProfileUrl: string | null;
  refreshing?: boolean;
};

type SecFilingState = {
  summary: string;
  form: string | null;
  filingDate: string | null;
  documentUrl: string | null;
  refreshing?: boolean;
};

function applySymbolStory(
  json: SymbolStoryPayload,
  opts: { refreshing?: boolean },
): { about: AboutState | null; sec: SecFilingState | null } {
  const text = (json.businessSummary ?? "").trim();
  const secSummary = (json.secFilingSummary ?? "").trim();
  const sources = openSourceAttribution(Array.isArray(json.sources) ? json.sources : []);
  const refreshing = opts.refreshing === true;

  const aboutState =
    text || refreshing
      ? {
          text,
          sources,
          yahooProfileUrl: json.yahooProfileUrl ?? null,
          refreshing,
        }
      : null;

  const secState =
    secSummary || json.secDocumentUrl || refreshing
      ? {
          summary: secSummary,
          form: json.secForm ?? null,
          filingDate: json.secFilingDate ?? null,
          documentUrl: json.secDocumentUrl ?? null,
          refreshing,
        }
      : null;

  return { about: aboutState, sec: secState };
}

type WindowKey = "1D" | "5D" | "1M" | "3M" | "6M" | "1Y" | "3Y" | "5Y";

export default function TerminalSymbolPage() {
  const privacy = usePrivacy();
  const params = useParams<{ symbol?: string }>();
  const sym = normSym(params?.symbol ?? "");

  const [quote, setQuote] = useState<NormalizedQuote | null>(null);
  const [company, setCompany] = useState<CompanyPayload | null>(null);
  const [benchSeries, setBenchSeries] = useState<Record<string, Array<{ date: string; close: number }>>>({});
  const [windowKey, setWindowKey] = useState<WindowKey>("6M");
  const [nowMs, setNowMs] = useState<number>(0);
  const [positions, setPositions] = useState<Row[]>([]);
  const [about, setAbout] = useState<AboutState | null>(null);
  const [secFiling, setSecFiling] = useState<SecFilingState | null>(null);
  const [aboutError, setAboutError] = useState<string | null>(null);
  const [secFilingError, setSecFilingError] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadAll() {
    setError(null);
    try {
      const storyCacheUrl = `/api/dividend-models/symbol-story?symbol=${encodeURIComponent(sym)}&mode=cache`;
      const [qResp, bResp, pResp, companyResp, storyCacheResp] = await Promise.all([
        fetch("/api/quotes", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          cache: "no-store",
          body: JSON.stringify({ symbols: [sym] }),
        }),
        fetch(`/api/performance/benchmarks?symbols=${encodeURIComponent([sym, "SPY", "QQQ"].join(","))}`, { cache: "no-store" }),
        fetch("/api/positions", { cache: "no-store" }),
        fetch(`/api/terminal/company?symbol=${encodeURIComponent(sym)}`, { cache: "no-store" }),
        fetch(storyCacheUrl, { cache: "no-store" }),
      ]);

      const qJson = (await qResp.json()) as { ok: boolean; quotes?: NormalizedQuote[]; error?: string };
      if (!qJson.ok) throw new Error(qJson.error ?? "Failed to load quote");
      setQuote((qJson.quotes ?? [])[0] ?? null);

      const bJson = (await bResp.json().catch(() => null)) as
        | { ok: boolean; series?: Record<string, Array<{ date: string; close: number }>> }
        | null;
      setBenchSeries(bJson?.series ?? {});

      const pJson = (await pResp.json()) as { ok: boolean; positions?: Row[]; error?: string };
      if (!pJson.ok) throw new Error(pJson.error ?? "Failed to load positions");
      const rows = (pJson.positions ?? []).filter((r) => {
        const s = normSym(r.symbol ?? "");
        const u = normSym(r.underlyingSymbol ?? "");
        const eff = normSym(r.effectiveUnderlyingSymbol ?? "");
        return s === sym || u === sym || eff === sym;
      });
      setPositions(rows);

      let companyPayload: CompanyPayload | null = null;
      if (companyResp.ok) {
        try {
          companyPayload = (await companyResp.json()) as CompanyPayload;
        } catch (e) {
          companyPayload = { ok: false, error: e instanceof Error ? e.message : "Invalid company response" };
        }
      } else {
        const errText = await companyResp.text().catch(() => "");
        let detail = errText.slice(0, 240);
        try {
          const j = JSON.parse(errText) as { error?: string };
          if (typeof j?.error === "string" && j.error) detail = j.error;
        } catch {
          /* keep text slice */
        }
        companyPayload = {
          ok: false,
          error: `Fundamentals request failed (${companyResp.status})${detail ? `: ${detail}` : ""}`,
        };
      }
      setCompany(companyPayload);

      setAboutError(null);
      setSecFilingError(null);
      try {
        const storyCacheJson = (await storyCacheResp.json()) as SymbolStoryPayload & { hasCache?: boolean };
        if (storyCacheJson.ok) {
          const applied = applySymbolStory(storyCacheJson, { refreshing: false });
          if (applied.about) setAbout(applied.about);
          if (applied.sec) setSecFiling(applied.sec);
        } else {
          setAboutError(storyCacheJson.error ?? "Could not load company description.");
        }
      } catch {
        setAboutError("Could not load company description.");
      }

      void (async () => {
        try {
          setAbout((prev) =>
            prev?.text ? { ...prev, refreshing: true } : { text: "", sources: [], yahooProfileUrl: null, refreshing: true },
          );
          setSecFiling((prev) =>
            prev?.summary ? { ...prev, refreshing: true } : { summary: "", form: null, filingDate: null, documentUrl: null, refreshing: true },
          );
          const revResp = await fetch(
            `/api/dividend-models/symbol-story?symbol=${encodeURIComponent(sym)}&mode=revalidate`,
            { cache: "no-store" },
          );
          const storyJson = (await revResp.json()) as SymbolStoryPayload;
          if (storyJson.ok) {
            const applied = applySymbolStory(storyJson, { refreshing: false });
            setAbout((prev) => {
              if (!applied.about?.text) return prev?.text ? { ...prev, refreshing: false } : null;
              return applied.about;
            });
            setSecFiling(applied.sec);
            setAboutError(null);
            setSecFilingError(null);
          } else {
            setAbout((prev) => (prev?.text ? { ...prev, refreshing: false } : null));
            setSecFiling((prev) => (prev?.summary ? { ...prev, refreshing: false } : null));
            setAboutError(storyJson.error ?? "Could not load company description.");
          }
        } catch {
          setAbout((prev) => (prev?.text ? { ...prev, refreshing: false } : prev));
          setSecFiling((prev) => (prev?.summary ? { ...prev, refreshing: false } : prev));
        }
      })();

    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void loadAll(), 0);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sym]);

  useSchwabRefreshCoordinator({
    onTick: () => void loadAll(),
    resetKey: `${sym}|${windowKey}`,
  });

  useEffect(() => {
    const t = setTimeout(() => setNowMs(Date.now()), 0);
    return () => clearTimeout(t);
  }, [sym, windowKey]);

  const exposure = useMemo(() => {
    let spotMv = 0;
    let synthMv = 0;
    let synthShares = 0;
    let heldShares = 0;
    for (const r of positions) {
      if (r.securityType === "option") {
        const d = typeof r.delta === "number" && Number.isFinite(r.delta) ? r.delta : 0;
        const shares = (r.quantity ?? 0) * 100 * d;
        synthShares += shares;
        const px = quote?.last ?? quote?.close ?? 0;
        synthMv += shares * px;
      } else {
        heldShares += r.quantity ?? 0;
        spotMv += r.marketValue ?? 0;
      }
    }
    return {
      heldShares,
      synthShares,
      netShares: heldShares + synthShares,
      spotMv,
      synthMv,
      netMv: spotMv + synthMv,
    };
  }, [positions, quote]);

  const sortedSymbolPositions = useMemo(() => {
    const list = [...positions];
    list.sort((a, b) => {
      const am = Math.abs(a.marketValue ?? 0);
      const bm = Math.abs(b.marketValue ?? 0);
      if (bm !== am) return bm - am;
      const as = a.securityType === "option" ? formatOptionSymbolDisplay(a) : a.symbol;
      const bs = b.securityType === "option" ? formatOptionSymbolDisplay(b) : b.symbol;
      return as.localeCompare(bs, undefined, { numeric: true, sensitivity: "base" });
    });
    return list;
  }, [positions]);

  const windowStartIso = useMemo(() => {
    const DAY = 24 * 60 * 60_000;
    const now = nowMs;
    const durMs =
      windowKey === "1D"
        ? 1 * DAY
        : windowKey === "5D"
          ? 5 * DAY
          : windowKey === "1M"
            ? 30 * DAY
            : windowKey === "3M"
              ? 92 * DAY
              : windowKey === "6M"
                ? 183 * DAY
                : windowKey === "1Y"
                  ? 365 * DAY
                  : windowKey === "3Y"
                    ? 3 * 365 * DAY
                    : 5 * 365 * DAY;
    return new Date(now - durMs).toISOString().slice(0, 10);
  }, [windowKey, nowMs]);

  const perfData = useMemo(() => {
    const s = benchSeries[sym] ?? [];
    const spy = benchSeries.SPY ?? [];
    const qqq = benchSeries.QQQ ?? [];
    if (s.length < 2) return [];

    function baseOnOrBefore(series: Array<{ date: string; close: number }>, baseDate: string): number {
      if (series.length === 0) return 1;
      // series is already sorted by date ASC from the backend.
      let lo = 0;
      let hi = series.length - 1;
      let bestIdx = -1;
      while (lo <= hi) {
        const mid = (lo + hi) >> 1;
        const d = series[mid]!.date;
        if (d <= baseDate) {
          bestIdx = mid;
          lo = mid + 1;
        } else hi = mid - 1;
      }
      const picked = bestIdx >= 0 ? series[bestIdx] : series[0];
      return picked?.close || 1;
    }

    const map = new Map<string, { sym?: number; spy?: number; qqq?: number }>();
    for (const p of s) map.set(p.date, { ...(map.get(p.date) ?? {}), sym: p.close });
    for (const p of spy) map.set(p.date, { ...(map.get(p.date) ?? {}), spy: p.close });
    for (const p of qqq) map.set(p.date, { ...(map.get(p.date) ?? {}), qqq: p.close });

    let dates = Array.from(map.keys()).sort((a, b) => a.localeCompare(b));
    dates = dates.filter((d) => d >= windowStartIso);
    if (dates.length < 2) dates = Array.from(map.keys()).sort((a, b) => a.localeCompare(b)).slice(-2);

    const baseDate = dates[0] ?? s[0]!.date;
    const firstSym = baseOnOrBefore(s, baseDate);
    const firstSpy = baseOnOrBefore(spy, baseDate);
    const firstQqq = baseOnOrBefore(qqq, baseDate);

    return dates
      .map((d) => {
        const v = map.get(d)!;
        if (v.sym == null) return null;
        return {
          date: d,
          sym: ((v.sym / firstSym) - 1) * 100,
          SPY: v.spy == null ? null : ((v.spy / firstSpy) - 1) * 100,
          QQQ: v.qqq == null ? null : ((v.qqq / firstQqq) - 1) * 100,
        };
      })
      .filter((x): x is { date: string; sym: number; SPY: number | null; QQQ: number | null } => !!x);
  }, [benchSeries, sym, windowStartIso]);

  const nameForHeader =
    company == null ? null : company.ok ? ((company.companyName ?? "").trim() || sym) : "Company name unavailable";

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="flex flex-wrap items-baseline gap-x-3 gap-y-1 text-2xl font-semibold tracking-tight text-zinc-900 dark:text-zinc-50">
            <span className="font-mono">{sym}</span>
            <span className="font-normal text-zinc-400 dark:text-zinc-500" aria-hidden>
              ·
            </span>
            <span>{nameForHeader == null ? "Loading…" : nameForHeader}</span>
          </h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Quote, fundamentals, and your portfolio exposure for this symbol (read-only). “What they do” uses Schwab,
            Yahoo Finance, and other open sources; SEC filing text is shown separately below (not investment advice).
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/terminal"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Terminal
          </Link>
          <Link
            href="/positions"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Positions
          </Link>
        </div>
      </div>

      {error ? (
        <div className="rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">{error}</div>
      ) : null}

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="grid min-w-0 gap-4 lg:grid-cols-3">
          <div className="rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
            <div className="text-sm font-semibold">Quote</div>
            <div className="mt-2 grid gap-2 text-sm tabular-nums">
              <div className="flex items-baseline justify-between">
                <div className="text-xs text-zinc-600 dark:text-zinc-400">Last</div>
                <div className={"text-lg font-semibold " + priceDirClass(quote?.last, quote?.close)}>
                  {quote?.last == null ? "—" : quote.last.toFixed(2)}
                </div>
              </div>
              <div className="flex items-baseline justify-between">
                <div className="text-xs text-zinc-600 dark:text-zinc-400">$ Chg</div>
                <div className={posNegClass(quote?.change)}>{quote?.change == null ? "—" : usd2Masked(quote.change, privacy.masked)}</div>
              </div>
              <div className="flex items-baseline justify-between">
                <div className="text-xs text-zinc-600 dark:text-zinc-400">% Chg</div>
                <div className={posNegClass(quote?.changePercent == null ? null : quote.changePercent * 100)}>
                  {quote?.changePercent == null ? "—" : PCT2.format(quote.changePercent * 100) + "%"}
                </div>
              </div>
              <div className="grid grid-cols-2 gap-2 text-xs text-zinc-600 dark:text-zinc-400">
                <div className={priceDirClass(quote?.bid, quote?.close)}>
                  Bid: {quote?.bid == null ? "—" : quote.bid.toFixed(2)}
                </div>
                <div className={priceDirClass(quote?.ask, quote?.close)}>
                  Ask: {quote?.ask == null ? "—" : quote.ask.toFixed(2)}
                </div>
                <div className={priceDirClass(quote?.high, quote?.close)}>
                  Day high: {quote?.high == null ? "—" : quote.high.toFixed(2)}
                </div>
                <div className={priceDirClass(quote?.low, quote?.close)}>
                  Day low: {quote?.low == null ? "—" : quote.low.toFixed(2)}
                </div>
                <div className={priceDirClass(quote?.week52High, quote?.close)}>
                  52w high: {quote?.week52High == null ? "—" : quote.week52High.toFixed(2)}
                </div>
                <div className={priceDirClass(quote?.week52Low, quote?.close)}>
                  52w low: {quote?.week52Low == null ? "—" : quote.week52Low.toFixed(2)}
                </div>
              </div>
            </div>
          </div>

          <div className="rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
            <div className="text-sm font-semibold">Company</div>
            {company?.ok !== true ? (
              <div className="mt-2 text-sm text-amber-800 dark:text-amber-200/90">
                {company == null
                  ? "Loading company data…"
                  : company.ok === false
                    ? company.error
                    : "Company fundamentals unavailable."}
              </div>
            ) : (
              <div className="mt-2 grid gap-2 text-sm">
                <div className="text-xs text-zinc-600 dark:text-zinc-400">
                  {(company.sector ?? "—") + (company.industry ? ` • ${company.industry}` : "")}
                </div>
                <div className="mt-1 grid grid-cols-2 gap-2 text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
                  <div>Market cap: {company.marketCap == null ? "—" : USD_COMPACT.format(company.marketCap)}</div>
                  <div>P/E: {company.pe == null ? "—" : company.pe.toFixed(1)}</div>
                  <div>Dividend: {company.divYield == null ? "—" : PCT2.format(company.divYield * 100) + "%"}</div>
                  <div>Beta: {company.beta == null ? "—" : company.beta.toFixed(2)}</div>
                  <div className={posNegClass(company.week52Low)}>52w low: {company.week52Low == null ? "—" : company.week52Low.toFixed(2)}</div>
                  <div className={posNegClass(company.week52High)}>52w high: {company.week52High == null ? "—" : company.week52High.toFixed(2)}</div>
                  <div>Avg vol: {company.avgVol == null ? "—" : Math.round(company.avgVol).toLocaleString()}</div>
                </div>
              </div>
            )}
          </div>

          <div className="rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
            <div className="text-sm font-semibold">At a glance</div>
            <div className="mt-2 grid grid-cols-2 gap-2 text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
              <div>Last: {quote?.last == null ? "—" : quote.last.toFixed(2)}</div>
              <div className={posNegClass(quote?.change)}>Chg: {quote?.change == null ? "—" : usd2Masked(quote.change, privacy.masked)}</div>
              <div className={posNegClass(quote?.changePercent == null ? null : quote.changePercent * 100)}>
                %: {quote?.changePercent == null ? "—" : PCT2.format(quote.changePercent * 100) + "%"}
              </div>
              <div>Vol: {quote?.volume == null ? "—" : formatInt(Math.round(quote.volume))}</div>
            </div>
          </div>
        </div>

        <div className="mt-4 rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
          <div className="text-sm font-semibold">What they do</div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Short issuer summary from Wikidata, Wikipedia, Yahoo Finance, and Schwab classification.
          </p>
          {aboutError ? (
            <div className="mt-2 text-sm text-amber-800 dark:text-amber-200/90">{aboutError}</div>
          ) : about?.text ? (
            <p className="mt-2 text-sm leading-7 text-zinc-700 dark:text-zinc-300">{about.text}</p>
          ) : (
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {about?.refreshing ? "Updating business description…" : "Loading business description…"}
            </div>
          )}
          {about?.refreshing && about?.text ? (
            <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-500">
              Refreshing from Wikidata, Wikipedia, and Yahoo Finance…
            </p>
          ) : null}
          {about?.sources?.length ? (
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">Sources: {about.sources.join(" · ")}</p>
          ) : null}
          {about?.yahooProfileUrl ? (
            <p className="mt-2 text-xs">
              <a
                href={about.yahooProfileUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-teal-700 underline underline-offset-2 hover:text-teal-600 dark:text-teal-300 dark:hover:text-teal-200"
                >
                  View on Yahoo Finance
                </a>
            </p>
          ) : null}
        </div>

        <div className="mt-4 rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
          <div className="text-sm font-semibold">SEC filing</div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Excerpt from the latest relevant EDGAR filing (10-K, 10-Q, 497, etc.).
          </p>
          {secFilingError ? (
            <div className="mt-2 text-sm text-amber-800 dark:text-amber-200/90">{secFilingError}</div>
          ) : secFiling?.summary ? (
            <p className="mt-2 text-sm leading-7 text-zinc-700 dark:text-zinc-300">{secFiling.summary}</p>
          ) : (
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
              {secFiling?.refreshing ? "Loading SEC filing excerpt…" : "No SEC filing excerpt available for this symbol."}
            </div>
          )}
          {secFiling?.form && secFiling.filingDate ? (
            <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-500">
              SEC {secFiling.form} filed {formatDisplayDate(secFiling.filingDate)} (EDGAR)
            </p>
          ) : null}
          {secFiling?.documentUrl ? (
            <p className="mt-2 text-xs">
              <a
                href={secFiling.documentUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="text-teal-700 underline underline-offset-2 hover:text-teal-600 dark:text-teal-300 dark:hover:text-teal-200"
              >
                View filing on SEC EDGAR
              </a>
            </p>
          ) : null}
        </div>

        <SymbolNotesSection symbol={sym} />

        <div className="mt-4 min-w-0 rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm font-semibold">Performance overlay (% rebased)</div>
            <div className="grid grid-cols-8 gap-1">
              {(["1D", "5D", "1M", "3M", "6M", "1Y", "3Y", "5Y"] as const).map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setWindowKey(k)}
                  className={
                    "h-8 rounded-md px-2 text-xs font-semibold " +
                    (windowKey === k
                      ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
                      : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
                  }
                >
                  {k}
                </button>
              ))}
            </div>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-xs text-zinc-600 dark:text-zinc-400">
            <div className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#0f766e" }} />
              <span className="font-medium text-zinc-700 dark:text-zinc-200">{sym}</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#2563eb" }} />
              <span className="font-medium text-zinc-700 dark:text-zinc-200">SPY</span>
            </div>
            <div className="inline-flex items-center gap-2">
              <span className="h-2.5 w-2.5 rounded-full" style={{ background: "#7c3aed" }} />
              <span className="font-medium text-zinc-700 dark:text-zinc-200">QQQ</span>
            </div>
          </div>
          {perfData.length < 2 ? (
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">Not enough cached history yet.</div>
          ) : (
            <div className="mt-2 h-72 w-full min-w-0">
              <ResponsiveContainer
                width="100%"
                height="100%"
                minWidth={0}
                minHeight={288}
                initialDimension={{ width: 400, height: 288 }}
              >
                <LineChart data={perfData}>
                  <CartesianGrid strokeDasharray="3 3" />
                  <XAxis dataKey="date" tick={false} />
                  <YAxis tickFormatter={(v) => `${Number(v).toFixed(0)}%`} />
                  <Tooltip formatter={(v) => `${Number(v).toFixed(2)}%`} labelFormatter={(l) => String(l)} />
                  <Line type="monotone" dataKey="sym" name={sym} strokeWidth={2} dot={false} stroke="#0f766e" />
                  <Line type="monotone" dataKey="SPY" name="SPY" strokeWidth={2} dot={false} stroke="#2563eb" />
                  <Line type="monotone" dataKey="QQQ" name="QQQ" strokeWidth={2} dot={false} stroke="#7c3aed" />
                </LineChart>
              </ResponsiveContainer>
            </div>
          )}
        </div>
      </section>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="text-sm font-semibold">Your exposure</div>
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded-xl border border-zinc-300 bg-white/60 p-3 text-sm dark:border-white/20 dark:bg-black/20">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Shares</div>
            <div className="mt-1 grid gap-1 tabular-nums">
              <div className="flex justify-between"><span>Held</span><span className={"font-semibold " + posNegClass(exposure.heldShares)}>{formatNum(exposure.heldShares, 2)}</span></div>
              <div className="flex justify-between"><span>Synthetic</span><span className={"font-semibold " + posNegClass(exposure.synthShares)}>{formatNum(exposure.synthShares, 2)}</span></div>
              <div className="flex justify-between"><span>Net</span><span className={"font-semibold " + posNegClass(exposure.netShares)}>{formatNum(exposure.netShares, 2)}</span></div>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-300 bg-white/60 p-3 text-sm dark:border-white/20 dark:bg-black/20">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Market value</div>
            <div className="mt-1 grid gap-1 tabular-nums">
              <div className="flex justify-between"><span>Spot</span><span className={"font-semibold " + posNegClass(exposure.spotMv)}>{usd2Masked(exposure.spotMv, privacy.masked)}</span></div>
              <div className="flex justify-between"><span>Synthetic</span><span className={"font-semibold " + posNegClass(exposure.synthMv)}>{usd2Masked(exposure.synthMv, privacy.masked)}</span></div>
              <div className="flex justify-between"><span>Net</span><span className={"font-semibold " + posNegClass(exposure.netMv)}>{usd2Masked(exposure.netMv, privacy.masked)}</span></div>
            </div>
          </div>
          <div className="rounded-xl border border-zinc-300 bg-white/60 p-3 text-sm dark:border-white/20 dark:bg-black/20">
            <div className="text-xs text-zinc-600 dark:text-zinc-400">Positions</div>
            <div className="mt-1 text-sm text-zinc-700 dark:text-zinc-300">
              {positions.length} row{positions.length === 1 ? "" : "s"} from latest snapshots
            </div>
          </div>
        </div>
        <div className="mt-4 rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
          <div className="text-sm font-semibold">All positions for {sym}</div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Latest snapshot rows linked to this symbol (spot and options). Click a symbol to open its terminal page.
          </p>
          {sortedSymbolPositions.length === 0 ? (
            <div className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">No positions found for this symbol.</div>
          ) : (
            <div className="mt-2 overflow-x-auto">
              <table className="min-w-[72rem] w-full text-sm">
                <thead className="text-xs text-zinc-600 dark:text-zinc-400">
                  <tr>
                    <th className="py-1 pr-4 text-left font-medium">Account</th>
                    <th className="py-1 pr-4 text-left font-medium">Symbol</th>
                    <th className="py-1 pr-4 text-right font-medium">Qty</th>
                    <th className="py-1 pr-4 text-right font-medium">Price</th>
                    <th className="py-1 pr-4 text-right font-medium">Market&nbsp;value</th>
                    <th className="py-1 pr-4 text-right font-medium">Delta</th>
                    <th className="py-1 pr-4 text-right font-medium">Gamma</th>
                    <th className="py-1 pr-4 text-right font-medium">Theta</th>
                    <th className="py-1 pr-4 text-right font-medium">DTE</th>
                    <th className="py-1 pr-4 text-right font-medium">Intrinsic</th>
                    <th className="py-1 pr-4 text-right font-medium">Extrinsic</th>
                    <th className="py-1 text-right font-medium">Synth&nbsp;sh</th>
                  </tr>
                </thead>
                <tbody className="tabular-nums text-zinc-900 dark:text-zinc-100">
                  {sortedSymbolPositions.map((r) => {
                    const synth = syntheticSharesForRow(r);
                    return (
                      <tr key={r.positionId} className="border-t border-zinc-200/70 dark:border-white/10">
                        <td className="whitespace-nowrap py-1 pr-4 text-left text-xs text-zinc-600 dark:text-zinc-400">
                          {r.accountName}
                        </td>
                        <td className="whitespace-nowrap py-1 pr-4 text-left font-medium">
                          <SymbolLink symbol={symbolPageTargetFromInstrument(r)} className="font-mono text-[13px]">
                            {r.securityType === "option" ? (
                              <span className={r.quantity < 0 ? "text-red-400" : "text-emerald-400"}>
                                {formatOptionSymbolDisplay(r)}
                              </span>
                            ) : (
                              <span>{r.symbol}</span>
                            )}
                          </SymbolLink>
                        </td>
                        <td className={"whitespace-nowrap py-1 pr-4 text-right " + posNegClass(r.quantity)}>
                          {formatInt(r.quantity)}
                        </td>
                        <td className="whitespace-nowrap py-1 pr-4 text-right">
                          {r.price == null ? "—" : usd2Unmasked(r.price)}
                        </td>
                        <td
                          className={
                            "whitespace-nowrap py-1 pr-4 text-right " +
                            (r.marketValue == null ? "" : posNegClass(r.marketValue))
                          }
                        >
                          {r.marketValue == null ? "—" : usd2Masked(r.marketValue, privacy.masked)}
                        </td>
                        <td className={"whitespace-nowrap py-1 pr-4 text-right " + posNegClass(r.delta)}>
                          {r.delta == null ? "—" : formatNum(r.delta, 3)}
                        </td>
                        <td className={"whitespace-nowrap py-1 pr-4 text-right " + posNegClass(r.gamma)}>
                          {r.gamma == null ? "—" : formatNum(r.gamma, 4)}
                        </td>
                        <td className={"whitespace-nowrap py-1 pr-4 text-right " + posNegClass(r.theta)}>
                          {r.theta == null ? "—" : formatNum(r.theta, 3)}
                        </td>
                        <td className="whitespace-nowrap py-1 pr-4 text-right">
                          {r.dte == null ? "—" : formatInt(r.dte)}
                        </td>
                        <td className="whitespace-nowrap py-1 pr-4 text-right text-zinc-800 dark:text-zinc-200">
                          {formatOptionIntExtPerShare(r.intrinsic, r.quantity, { mask: privacy.masked })}
                        </td>
                        <td className="whitespace-nowrap py-1 pr-4 text-right text-zinc-800 dark:text-zinc-200">
                          {formatOptionIntExtPerShare(r.extrinsic, r.quantity, { mask: privacy.masked })}
                        </td>
                        <td className={"whitespace-nowrap py-1 text-right font-semibold " + posNegClass(synth)}>
                          {synth == null ? "—" : synth.toFixed(2)}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </section>
    </div>
  );
}

