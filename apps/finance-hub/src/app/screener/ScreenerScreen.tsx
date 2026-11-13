"use client";

import { useEffect, useMemo, useState } from "react";

import { PAGE_FRAME } from "@/app/components/pageFrame";
import { MARKET_CAP_BAND_RULES } from "@/lib/screener/bands";
import { citationLines, formatCorrelation, formatMarketCap, formatRatio } from "@/lib/screener/display";
import { applyFilters, EMPTY_FILTERS } from "@/lib/screener/filter";
import { SCREENER_API, SCREENER_NAME, SCREENER_REFRESH_LIMIT } from "@/lib/screener/name";
import { screenerCsv } from "@/lib/screener/csv";
import { sourceLabel } from "@/lib/screener/sourcesMeta";
import type { Cited, CorrBand, CorrWindow, ScreenerFilters, ScreenerPageData, ScreenerRow, WarRating } from "@/lib/screener/types";
import { CORR_WINDOWS, WAR_RATINGS } from "@/lib/screener/types";

const control =
  "h-9 rounded-md border border-zinc-400 bg-zinc-950 px-2 text-sm text-zinc-100 outline-none focus:border-zinc-200 [color-scheme:dark]";
const label = "text-[11px] font-semibold uppercase tracking-wide text-zinc-300";
const button =
  "rounded-md border border-zinc-400 bg-zinc-950 px-3 py-1.5 text-sm font-semibold text-zinc-100 hover:bg-zinc-900";

type SortKey = "ticker" | "name" | "sector" | "marketCap" | "peTrailing" | "peForward" | "peg" | "psTrailing" | "psForward" | "corrSpy" | "corrQqq" | "war" | "sizeRank";

function numOf(cited: Cited): number | null {
  return cited.valueNum;
}

function sortValue(row: ScreenerRow, key: SortKey, window: CorrWindow): string | number | null {
  switch (key) {
    case "ticker":
      return row.ticker;
    case "name":
      return row.name;
    case "sector":
      return row.sector.valueText;
    case "marketCap":
      return numOf(row.marketCap);
    case "peTrailing":
      return numOf(row.peTrailing);
    case "peForward":
      return numOf(row.peForward);
    case "peg":
      return numOf(row.peg);
    case "psTrailing":
      return numOf(row.psTrailing);
    case "psForward":
      return numOf(row.psForward);
    case "corrSpy":
      return numOf(row.corrSpy[window]);
    case "corrQqq":
      return numOf(row.corrQqq[window]);
    case "war":
      return row.war.valueText;
    case "sizeRank":
      return row.sizeRank;
    default:
      return null;
  }
}

function compareSort(a: string | number | null, b: string | number | null): number {
  if (a == null && b == null) return 0;
  if (a == null) return 1;
  if (b == null) return -1;
  if (typeof a === "number" && typeof b === "number") return a - b;
  return String(a).localeCompare(String(b));
}

export function ScreenerScreen({ initial = null }: { initial?: ScreenerPageData | null }) {
  const [data, setData] = useState<ScreenerPageData | null>(initial);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState<ScreenerFilters>(EMPTY_FILTERS);
  const [sortKey, setSortKey] = useState<SortKey>("marketCap");
  const [sortAsc, setSortAsc] = useState(false);
  const [selected, setSelected] = useState<string[]>([]);
  const [openCite, setOpenCite] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [presetName, setPresetName] = useState("");
  const [addTicker, setAddTicker] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (data) return;
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch(SCREENER_API);
        const json = (await resp.json()) as ScreenerPageData & { ok?: boolean; error?: string };
        if (cancelled) return;
        if (!resp.ok || json.ok === false) {
          setError(json.error ?? "Screener could not load.");
          return;
        }
        setData(json);
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [data]);

  const filtered = useMemo(() => {
    if (!data) return [];
    const matched = applyFilters(data.rows, filters);
    const dir = sortAsc ? 1 : -1;
    return matched.slice().sort((a, b) => dir * compareSort(sortValue(a, sortKey, filters.corrWindow), sortValue(b, sortKey, filters.corrWindow)) || a.ticker.localeCompare(b.ticker));
  }, [data, filters, sortAsc, sortKey]);

  async function post(body: unknown) {
    setBusy(true);
    setNotice(null);
    try {
      const resp = await fetch(SCREENER_API, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const json = (await resp.json()) as ScreenerPageData & { ok?: boolean; error?: string; refresh?: { deferred: string[]; attempts: Array<{ status: string; detail?: string; source: string; ticker: string }> } };
      if (!resp.ok || json.ok === false) {
        setNotice(json.error ?? "Request failed.");
        if (json.rows) setData(json);
        return;
      }
      setData(json);
      if (json.refresh) {
        const failed = json.refresh.attempts.filter((attempt) => attempt.status === "failed");
        const skipped = json.refresh.attempts.filter((attempt) => attempt.status === "skipped");
        const bits = [`Refreshed ${json.refresh.attempts.length ? "with source results below" : "nothing"}.`];
        if (json.refresh.deferred.length) bits.push(`${json.refresh.deferred.length} tickers waited because a refresh is capped at ${SCREENER_REFRESH_LIMIT}.`);
        if (skipped.length) bits.push(`${skipped.length} source calls were skipped (missing key or not connected).`);
        if (failed.length) bits.push(`${failed.length} source calls returned nothing and left the cell on its last cited value, or blank.`);
        setNotice(bits.join(" "));
      }
    } catch (err) {
      setNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  }

  function toggleSort(key: SortKey) {
    if (sortKey === key) setSortAsc((value) => !value);
    else {
      setSortKey(key);
      setSortAsc(key === "ticker" || key === "name" || key === "sector" || key === "war");
    }
  }

  function downloadCsv() {
    const csv = screenerCsv(filtered, filters.corrWindow);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "screener.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  if (error) {
    return (
      <div className={PAGE_FRAME}>
        <h1 className="text-2xl font-semibold text-zinc-100">{SCREENER_NAME}</h1>
        <p className="text-sm text-zinc-300">{error}</p>
      </div>
    );
  }
  if (!data) {
    return (
      <div className={PAGE_FRAME}>
        <h1 className="text-2xl font-semibold text-zinc-100">{SCREENER_NAME}</h1>
        <p className="text-sm text-zinc-300">Loading cited figures.</p>
      </div>
    );
  }

  const sectors = [...new Set(data.rows.map((row) => row.sector.valueText).filter((value): value is string => Boolean(value)))].sort();
  const compared = data.rows.filter((row) => selected.includes(row.ticker));
  const activePreset = data.presets.find((preset) => JSON.stringify(preset.filters) === JSON.stringify(filters));

  return (
    <div className={PAGE_FRAME}>
      <style>{`@media print { .screener-no-print { display: none !important; } .screener-cite { display: block !important; color: #111 !important; } body, main { background: #fff !important; color: #111 !important; height: auto !important; overflow: visible !important; } }`}</style>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-zinc-100 print:text-black">{data.name}</h1>
          <p className="mt-1 max-w-3xl text-sm text-zinc-300 print:text-black">
            Analysis only. A cell stays blank unless a source and an as-of date are on file. Forward P/E and forward P/S are consensus estimates.
            Correlation bands use the absolute value: H ≥ 0.50, M 0.25–0.49, L below 0.25.
          </p>
        </div>
        <div className="screener-no-print flex flex-wrap gap-2">
          <button type="button" className={button} onClick={downloadCsv}>Export CSV</button>
          <button type="button" className={button} onClick={() => window.print()}>Print</button>
        </div>
      </header>

      <p className="text-sm text-zinc-300 print:text-black">
        Universe: {data.universe.sp500Count} S&P 500 constituents from{" "}
        <a className="underline" href={data.universe.sp500RevisionUrl}>
          {"Wikipedia's List of S&P 500 companies"}
        </a>
        , revision {data.universe.sp500RevisionTimestamp.slice(0, 10)}, retrieved {data.universe.sp500RetrievedOn}.
        Report figures are as of {data.universe.figuresAsOf} ({data.universe.figuresAsOfDetail}).
        {data.universe.reportOnlyTickers.length ? ` Not in that constituent table: ${data.universe.reportOnlyTickers.join(", ")}.` : ""}
      </p>
      <ul className="screener-no-print flex flex-wrap gap-2 text-xs text-zinc-300">
        {data.sources.map((source) => (
          <li key={source.id} className="rounded-md border border-zinc-400 bg-zinc-950 px-2 py-1">
            {source.label}: {source.state === "ready" ? "ready" : "skipped"}
            {source.env ? ` (${source.env})` : ""}. {source.detail}
          </li>
        ))}
      </ul>
      {notice ? <p className="screener-no-print text-sm text-zinc-200">{notice}</p> : null}
      <p className="hidden text-sm print:block">Screen: {activePreset?.name ?? "Custom filters"}. {filtered.length} rows. Printed for household review.</p>

      <section className="screener-no-print flex flex-col gap-4 rounded-lg border border-zinc-400 bg-zinc-950 p-4">
        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={label}>Saved screen</span>
            <select
              className={control}
              value={activePreset?.id ?? ""}
              onChange={(event) => {
                const preset = data.presets.find((item) => item.id === event.target.value);
                if (preset) setFilters(preset.filters);
              }}
            >
              <option value="">Custom</option>
              {data.presets.map((preset) => (
                <option key={preset.id} value={preset.id}>{preset.name}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Save current as</span>
            <input className={control} value={presetName} onChange={(event) => setPresetName(event.target.value)} />
          </label>
          <button type="button" className={button} disabled={busy} onClick={() => void post({ op: "savePreset", name: presetName, filters })}>Save screen</button>
          <button type="button" className={button} onClick={() => setFilters(EMPTY_FILTERS)}>Clear filters</button>
          <label className="flex items-center gap-2 text-sm text-zinc-100">
            <input
              type="checkbox"
              checked={!filters.requireCited}
              onChange={(event) => setFilters({ ...filters, requireCited: !event.target.checked })}
            />
            Show S&P 500 names with no figures yet
          </label>
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={label}>Sector</legend>
          <div className="flex flex-wrap gap-2">
            {sectors.map((sector) => (
              <label key={sector} className="flex items-center gap-1 text-sm text-zinc-100">
                <input
                  type="checkbox"
                  checked={filters.sectors.includes(sector)}
                  onChange={(event) => {
                    const sectorsNext = event.target.checked ? [...filters.sectors, sector] : filters.sectors.filter((item) => item !== sector);
                    setFilters({ ...filters, sectors: sectorsNext });
                  }}
                />
                {sector}
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="flex flex-col gap-2">
          <legend className={label}>Market cap band</legend>
          <div className="flex flex-wrap gap-2">
            {MARKET_CAP_BAND_RULES.map((band) => (
              <label key={band.id} className="flex items-center gap-1 text-sm text-zinc-100">
                <input
                  type="checkbox"
                  checked={filters.marketCapBands.includes(band.id)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...filters.marketCapBands, band.id]
                      : filters.marketCapBands.filter((item) => item !== band.id);
                    setFilters({ ...filters, marketCapBands: next });
                  }}
                />
                {band.label}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end gap-3">
          <label className="flex flex-col gap-1">
            <span className={label}>Correlation</span>
            <select className={control} value={filters.corrTarget} onChange={(event) => setFilters({ ...filters, corrTarget: event.target.value as ScreenerFilters["corrTarget"] })}>
              <option value="spy">SPY</option>
              <option value="qqq">QQQ</option>
              <option value="both">SPY and QQQ</option>
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Window</span>
            <select className={control} value={filters.corrWindow} onChange={(event) => setFilters({ ...filters, corrWindow: event.target.value as CorrWindow })}>
              {CORR_WINDOWS.map((window) => (
                <option key={window} value={window}>{window}</option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className={label}>Band</span>
            <select className={control} value={filters.corrBand ?? ""} onChange={(event) => setFilters({ ...filters, corrBand: (event.target.value || null) as CorrBand | null })}>
              <option value="">Any</option>
              <option value="H">H ≥ 0.50</option>
              <option value="M">M 0.25–0.49</option>
              <option value="L">L &lt; 0.25</option>
            </select>
          </label>
          <NumberField label="Corr min" value={filters.corrMin} onChange={(corrMin) => setFilters({ ...filters, corrMin })} />
          <NumberField label="Corr max" value={filters.corrMax} onChange={(corrMax) => setFilters({ ...filters, corrMax })} />
          <NumberField label="Size rank ≤" value={filters.sizeRankMax} onChange={(sizeRankMax) => setFilters({ ...filters, sizeRankMax })} />
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <NumberField label="Trail P/E min" value={filters.peTrailingMin} onChange={(peTrailingMin) => setFilters({ ...filters, peTrailingMin })} />
          <NumberField label="Trail P/E max" value={filters.peTrailingMax} onChange={(peTrailingMax) => setFilters({ ...filters, peTrailingMax })} />
          <NumberField label="Fwd P/E min" value={filters.peForwardMin} onChange={(peForwardMin) => setFilters({ ...filters, peForwardMin })} />
          <NumberField label="Fwd P/E max" value={filters.peForwardMax} onChange={(peForwardMax) => setFilters({ ...filters, peForwardMax })} />
          <NumberField label="PEG min" value={filters.pegMin} onChange={(pegMin) => setFilters({ ...filters, pegMin })} />
          <NumberField label="PEG max" value={filters.pegMax} onChange={(pegMax) => setFilters({ ...filters, pegMax, pegMaxInclusive: true })} />
          <NumberField label="Trail P/S min" value={filters.psTrailingMin} onChange={(psTrailingMin) => setFilters({ ...filters, psTrailingMin })} />
          <NumberField label="Trail P/S max" value={filters.psTrailingMax} onChange={(psTrailingMax) => setFilters({ ...filters, psTrailingMax })} />
          <NumberField label="Fwd P/S min" value={filters.psForwardMin} onChange={(psForwardMin) => setFilters({ ...filters, psForwardMin })} />
          <NumberField label="Fwd P/S max" value={filters.psForwardMax} onChange={(psForwardMax) => setFilters({ ...filters, psForwardMax })} />
        </div>

        <fieldset className="flex flex-col gap-2">
          <legend className={label}>War exposure</legend>
          <div className="flex flex-wrap gap-2">
            {WAR_RATINGS.map((rating) => (
              <label key={rating} className="flex items-center gap-1 text-sm text-zinc-100">
                <input
                  type="checkbox"
                  checked={filters.warExposure.includes(rating)}
                  onChange={(event) => {
                    const next = event.target.checked
                      ? [...filters.warExposure, rating]
                      : filters.warExposure.filter((item) => item !== rating);
                    setFilters({ ...filters, warExposure: next });
                  }}
                />
                {rating}
              </label>
            ))}
          </div>
        </fieldset>

        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className={label}>Add ticker</span>
            <input className={control} value={addTicker} onChange={(event) => setAddTicker(event.target.value.toUpperCase())} placeholder="TICKER" />
          </label>
          <button type="button" className={button} disabled={busy} onClick={() => void post({ op: "addTicker", ticker: addTicker }).then(() => setAddTicker(""))}>Add</button>
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => void post({ op: "refresh", tickers: selected.length ? selected : filtered.slice(0, SCREENER_REFRESH_LIMIT).map((row) => row.ticker) })}
          >
            Refresh {selected.length ? "selected" : `first ${Math.min(SCREENER_REFRESH_LIMIT, filtered.length)}`}
          </button>
          <span className="text-xs text-zinc-300">A refresh reads free sources and does not place orders. Cap {SCREENER_REFRESH_LIMIT} names.</span>
        </div>
      </section>

      <p className="text-sm text-zinc-300 print:text-black">
        {filtered.length} of {data.rows.length} names. Superscript 1 is a single source. ≠ means another source differs by more than 5%. Hover or click a figure for the source and as-of date.
      </p>

      <div className="max-h-[70vh] overflow-auto rounded-lg border border-zinc-400 print:max-h-none print:overflow-visible">
        <table className="w-full border-collapse text-left text-sm">
          <thead className="sticky top-0 bg-zinc-950 text-zinc-200 print:bg-white print:text-black">
            <tr>
              <th className="p-2" />
              <SortHead label="Ticker" active={sortKey === "ticker"} onClick={() => toggleSort("ticker")} />
              <SortHead label="Name" active={sortKey === "name"} onClick={() => toggleSort("name")} />
              <SortHead label="Sector" active={sortKey === "sector"} onClick={() => toggleSort("sector")} />
              <th className="p-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-200 print:text-black">Industry</th>
              <SortHead label="Mkt cap" active={sortKey === "marketCap"} onClick={() => toggleSort("marketCap")} />
              <SortHead label="Trail P/E" active={sortKey === "peTrailing"} onClick={() => toggleSort("peTrailing")} />
              <SortHead label="Fwd P/E" active={sortKey === "peForward"} onClick={() => toggleSort("peForward")} />
              <SortHead label="PEG" active={sortKey === "peg"} onClick={() => toggleSort("peg")} />
              <SortHead label="Trail P/S" active={sortKey === "psTrailing"} onClick={() => toggleSort("psTrailing")} />
              <SortHead label="Fwd P/S" active={sortKey === "psForward"} onClick={() => toggleSort("psForward")} />
              <th className="p-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-200 print:text-black">Rev TTM</th>
              <th className="p-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-200 print:text-black">EPS TTM</th>
              <SortHead label="SPY" active={sortKey === "corrSpy"} onClick={() => toggleSort("corrSpy")} />
              <SortHead label="QQQ" active={sortKey === "corrQqq"} onClick={() => toggleSort("corrQqq")} />
              <SortHead label="War" active={sortKey === "war"} onClick={() => toggleSort("war")} />
              <th className="p-2 text-[11px] font-semibold uppercase tracking-wide">Why it matched</th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((row) => (
              <tr key={row.ticker} className="border-t border-zinc-700 align-top text-zinc-100 print:border-zinc-300 print:text-black">
                <td className="p-2">
                  <input
                    className="screener-no-print"
                    type="checkbox"
                    checked={selected.includes(row.ticker)}
                    aria-label={`Select ${row.ticker}`}
                    onChange={(event) => {
                      setSelected((current) => (event.target.checked ? [...current, row.ticker] : current.filter((item) => item !== row.ticker)));
                    }}
                  />
                </td>
                <td className="p-2 font-mono">{row.ticker}</td>
                <td className="p-2">{row.name ?? "—"}</td>
                <td className="p-2"><Cite id={`${row.ticker}:sector`} open={openCite} setOpen={setOpenCite} cited={row.sector} text={row.sector.valueText ?? "—"} /></td>
                <td className="p-2"><Cite id={`${row.ticker}:ind`} open={openCite} setOpen={setOpenCite} cited={row.industry} text={row.industry.valueText ?? "—"} /></td>
                <td className="p-2 font-mono"><Cite id={`${row.ticker}:cap`} open={openCite} setOpen={setOpenCite} cited={row.marketCap} text={formatMarketCap(row.marketCap.valueNum, row.marketCap.source === "report:2026-11-12-close" && typeof row.marketCap.meta?.marketCapText === "string" ? row.marketCap.meta.marketCapText : null)} /></td>
                <td className="p-2 font-mono"><Cite id={`${row.ticker}:pet`} open={openCite} setOpen={setOpenCite} cited={row.peTrailing} text={formatRatio(row.peTrailing.valueNum)} /></td>
                <td className="p-2 font-mono"><Cite id={`${row.ticker}:pef`} open={openCite} setOpen={setOpenCite} cited={row.peForward} text={formatRatio(row.peForward.valueNum)} estimate /></td>
                <td className="p-2 font-mono"><Cite id={`${row.ticker}:peg`} open={openCite} setOpen={setOpenCite} cited={row.peg} text={formatRatio(row.peg.valueNum)} /></td>
                <td className="p-2 font-mono"><Cite id={`${row.ticker}:pst`} open={openCite} setOpen={setOpenCite} cited={row.psTrailing} text={formatRatio(row.psTrailing.valueNum)} /></td>
                <td className="p-2 font-mono"><Cite id={`${row.ticker}:psf`} open={openCite} setOpen={setOpenCite} cited={row.psForward} text={formatRatio(row.psForward.valueNum)} estimate /></td>
                <td className="p-2 font-mono"><Cite id={`${row.ticker}:rev`} open={openCite} setOpen={setOpenCite} cited={row.revenueTtm} text={formatMarketCap(row.revenueTtm.valueNum)} /></td>
                <td className="p-2 font-mono"><Cite id={`${row.ticker}:eps`} open={openCite} setOpen={setOpenCite} cited={row.epsTtm} text={formatRatio(row.epsTtm.valueNum)} /></td>
                <td className="p-2 font-mono"><Cite id={`${row.ticker}:spy`} open={openCite} setOpen={setOpenCite} cited={row.corrSpy[filters.corrWindow]} text={formatCorrelation(row.corrSpy[filters.corrWindow].valueNum)} /></td>
                <td className="p-2 font-mono"><Cite id={`${row.ticker}:qqq`} open={openCite} setOpen={setOpenCite} cited={row.corrQqq[filters.corrWindow]} text={formatCorrelation(row.corrQqq[filters.corrWindow].valueNum)} /></td>
                <td className="p-2">
                  <Cite id={`${row.ticker}:war`} open={openCite} setOpen={setOpenCite} cited={row.war} text={row.war.valueText ?? "—"} unverified={row.warUnverified} note={row.warNote} />
                  {openCite === `${row.ticker}:war` ? (
                    <WarForm
                      ticker={row.ticker}
                      rating={(row.war.valueText ?? "n/a") as WarRating}
                      sourceUrl={row.war.sourceUrl ?? ""}
                      unverified={row.warUnverified}
                      busy={busy}
                      onSave={(payload) => void post({ op: "updateWar", ticker: row.ticker, ...payload })}
                    />
                  ) : null}
                </td>
                <td className="max-w-xs p-2 text-xs text-zinc-300 print:text-black">{row.why.join("; ")}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <section className="rounded-lg border border-zinc-400 bg-zinc-950 p-4 print:bg-white print:text-black">
        <h2 className="text-lg font-semibold text-zinc-100 print:text-black">Compare</h2>
        {compared.length < 2 ? (
          <p className="mt-2 text-sm text-zinc-300 print:text-black">Select two or more tickers to put them side by side.</p>
        ) : (
          <div className="mt-3 overflow-auto">
            <table className="w-full border-collapse text-sm">
              <thead>
                <tr>
                  <th className="p-2 text-left text-zinc-300">Field</th>
                  {compared.map((row) => (
                    <th key={row.ticker} className="p-2 text-left font-mono text-zinc-100 print:text-black">{row.ticker}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                <CompareRow label="Name" values={compared.map((row) => row.name ?? "—")} />
                <CompareRow label="Sector" values={compared.map((row) => row.sector.valueText ?? "—")} cites={compared.map((row) => row.sector)} />
                <CompareRow label="Industry" values={compared.map((row) => row.industry.valueText ?? "—")} cites={compared.map((row) => row.industry)} />
                <CompareRow label="What they do" values={compared.map((row) => row.blurb.valueText ?? "—")} cites={compared.map((row) => row.blurb)} />
                <CompareRow label="Market cap" values={compared.map((row) => formatMarketCap(row.marketCap.valueNum, typeof row.marketCap.meta?.marketCapText === "string" ? row.marketCap.meta.marketCapText : null))} cites={compared.map((row) => row.marketCap)} />
                <CompareRow label="Trailing P/E" values={compared.map((row) => formatRatio(row.peTrailing.valueNum))} cites={compared.map((row) => row.peTrailing)} />
                <CompareRow label="Forward P/E (consensus)" values={compared.map((row) => formatRatio(row.peForward.valueNum))} cites={compared.map((row) => row.peForward)} />
                <CompareRow label="PEG" values={compared.map((row) => formatRatio(row.peg.valueNum))} cites={compared.map((row) => row.peg)} />
                <CompareRow label="Trailing P/S" values={compared.map((row) => formatRatio(row.psTrailing.valueNum))} cites={compared.map((row) => row.psTrailing)} />
                <CompareRow label="Forward P/S (consensus)" values={compared.map((row) => formatRatio(row.psForward.valueNum))} cites={compared.map((row) => row.psForward)} />
                <CompareRow label="Revenue TTM" values={compared.map((row) => formatMarketCap(row.revenueTtm.valueNum))} cites={compared.map((row) => row.revenueTtm)} />
                <CompareRow label="EPS TTM" values={compared.map((row) => formatRatio(row.epsTtm.valueNum))} cites={compared.map((row) => row.epsTtm)} />
                <CompareRow label="Schwab P/E (basis unstated)" values={compared.map((row) => formatRatio(row.peSchwab.valueNum))} cites={compared.map((row) => row.peSchwab)} />
                <CompareRow label={`SPY ${filters.corrWindow}`} values={compared.map((row) => formatCorrelation(row.corrSpy[filters.corrWindow].valueNum))} cites={compared.map((row) => row.corrSpy[filters.corrWindow])} />
                <CompareRow label={`QQQ ${filters.corrWindow}`} values={compared.map((row) => formatCorrelation(row.corrQqq[filters.corrWindow].valueNum))} cites={compared.map((row) => row.corrQqq[filters.corrWindow])} />
                <CompareRow label="War exposure" values={compared.map((row) => `${row.war.valueText ?? "—"}${row.warUnverified ? " (unverified)" : ""}`)} cites={compared.map((row) => row.war)} />
              </tbody>
            </table>
          </div>
        )}
      </section>
      <p className="text-xs text-zinc-300 print:text-black">
        Market-cap bands are screen definitions: mega ≥ $200B, large $10B–$200B, mid $2B–$10B, small $300M–$2B, micro below $300M.
        Size rank is the order of cited market caps.
      </p>
    </div>
  );
}

function NumberField({ label: text, value, onChange }: { label: string; value: number | null; onChange: (value: number | null) => void }) {
  return (
    <label className="flex flex-col gap-1">
      <span className={label}>{text}</span>
      <input
        className={`${control} w-28`}
        inputMode="decimal"
        value={value ?? ""}
        onChange={(event) => {
          const next = event.target.value.trim();
          onChange(next === "" || !Number.isFinite(Number(next)) ? null : Number(next));
        }}
      />
    </label>
  );
}

function SortHead({ label: text, active, onClick }: { label: string; active: boolean; onClick: () => void }) {
  return (
    <th className="p-2">
      <button type="button" className={`text-[11px] font-semibold uppercase tracking-wide ${active ? "text-zinc-50" : "text-zinc-200"} print:text-black`} onClick={onClick}>
        {text}
      </button>
    </th>
  );
}

function Cite({
  id,
  open,
  setOpen,
  cited,
  text,
  estimate,
  unverified,
  note,
}: {
  id: string;
  open: string | null;
  setOpen: (id: string | null) => void;
  cited: Cited;
  text: string;
  estimate?: boolean;
  unverified?: boolean;
  note?: string | null;
}) {
  const lines = citationLines(cited);
  if (note) lines.push(note);
  const tip = lines.join("\n");
  return (
    <span className="relative inline-flex flex-col">
      <button
        type="button"
        className="text-left text-zinc-100 print:text-black"
        title={tip}
        aria-expanded={open === id}
        onClick={() => setOpen(open === id ? null : id)}
      >
        {text}
        {estimate && text !== "—" ? <span className="ml-1 text-[10px] uppercase tracking-wide text-zinc-300">cons.</span> : null}
        {cited.singleSource && text !== "—" ? <sup className="ml-0.5 text-zinc-300">1</sup> : null}
        {cited.disagreement ? <sup className="ml-0.5 text-amber-300">≠</sup> : null}
        {unverified && text !== "—" ? <sup className="ml-0.5 text-zinc-300">?</sup> : null}
      </button>
      <span className="screener-cite hidden text-[10px] leading-snug text-zinc-300">{sourceLabel(cited.source)}{cited.asOf ? ` · ${cited.asOf}` : ""}</span>
      {open === id ? (
        <span className="absolute left-0 top-full z-20 mt-1 w-72 rounded-md border border-zinc-400 bg-zinc-950 p-2 text-xs font-sans text-zinc-100 shadow-lg">
          {lines.map((line) => (
            <span key={line} className="block">{line}</span>
          ))}
        </span>
      ) : null}
    </span>
  );
}

function WarForm({
  ticker,
  rating,
  sourceUrl,
  unverified,
  busy,
  onSave,
}: {
  ticker: string;
  rating: WarRating;
  sourceUrl: string;
  unverified: boolean;
  busy: boolean;
  onSave: (payload: { rating: WarRating; sourceUrl: string; unverified: boolean }) => void;
}) {
  const [nextRating, setRating] = useState(rating);
  const [nextUrl, setUrl] = useState(sourceUrl);
  const [nextFlag, setFlag] = useState(unverified);
  return (
    <form
      className="screener-no-print mt-2 flex w-56 flex-col gap-1"
      onSubmit={(event) => {
        event.preventDefault();
        onSave({ rating: nextRating, sourceUrl: nextUrl, unverified: nextFlag });
      }}
    >
      <span className="text-[10px] uppercase tracking-wide text-zinc-300">Edit {ticker} war exposure</span>
      <select className={control} value={nextRating} onChange={(event) => setRating(event.target.value as WarRating)}>
        {WAR_RATINGS.map((item) => (
          <option key={item} value={item}>{item}</option>
        ))}
      </select>
      <input className={control} value={nextUrl} placeholder="https:// source" onChange={(event) => setUrl(event.target.value)} />
      <label className="flex items-center gap-1 text-xs text-zinc-100">
        <input type="checkbox" checked={nextFlag} onChange={(event) => setFlag(event.target.checked)} />
        Single-source / unverified
      </label>
      <button type="submit" className={button} disabled={busy}>Save rating</button>
    </form>
  );
}

function CompareRow({ label: text, values, cites }: { label: string; values: string[]; cites?: Cited[] }) {
  return (
    <tr className="border-t border-zinc-700 print:border-zinc-300">
      <th className="p-2 text-left font-medium text-zinc-300 print:text-black">{text}</th>
      {values.map((value, index) => (
        <td key={`${text}-${index}`} className="p-2 text-zinc-100 print:text-black" title={cites?.[index] ? citationLines(cites[index]!).join("\n") : undefined}>
          {value}
          {cites?.[index]?.asOf ? <span className="mt-1 block text-[10px] text-zinc-300 print:text-black">{sourceLabel(cites[index]!.source)} · {cites[index]!.asOf}</span> : null}
        </td>
      ))}
    </tr>
  );
}
