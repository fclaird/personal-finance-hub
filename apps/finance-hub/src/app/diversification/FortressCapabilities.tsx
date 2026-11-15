"use client";

import { useState } from "react";

import { positionLiquidity } from "@/lib/fortress/liquidity";
import { OPTION_MARGIN_SOURCE, OPTION_MARGIN_SOURCE_DATE, regTMargin } from "@/lib/fortress/optionMargin";
import { gapFactor, replayAdjusted, shockFactor, STYLE_SHOCKS } from "@/lib/fortress/scenarios";
import { sourcedName, type SourcedName } from "@/lib/fortress/sourcedExposure";
import type { SeriesBundle } from "@/lib/fortress/returns";
import type { Snapshot } from "@/lib/fortress/types";
import { labControl, labLabel } from "@/lib/strategyLab/palette";

const text = "text-sm text-zinc-900 dark:text-zinc-100";
const muted = "text-xs text-zinc-700 dark:text-zinc-300";
const field = `mt-1 block w-full px-2 py-1.5 text-sm ${labControl}`;

function money(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "blank";
  return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
}

export function FortressCapabilities({
  snapshot,
  spots,
  series,
  onShock,
  onOptionFixture,
}: {
  snapshot: Snapshot;
  spots: Readonly<Record<string, number>>;
  series: readonly SeriesBundle[] | null;
  onShock: (factors: string, label: string) => void;
  onOptionFixture: () => void;
}) {
  const [gap, setGap] = useState("-20");
  const [volumeText, setVolumeText] = useState("");
  const [bid, setBid] = useState("");
  const [ask, setAsk] = useState("");
  const [exposures, setExposures] = useState<SourcedName[] | null>(null);
  const [exposureNote, setExposureNote] = useState("Sourced exposures are not loaded. A missing source stays blank.");
  const margin = snapshot.positions.some((position) => position.kind === "option") ? regTMargin(snapshot, spots, snapshot.margin.maintenanceLong) : null;
  const names = [...new Set(snapshot.positions.map((position) => (position.kind === "option" ? position.contract.underlying : position.symbol)))];

  async function loadExposures() {
    if (names.length === 0) {
      setExposureNote("The book has no symbols.");
      return;
    }
    try {
      const response = await fetch(`/api/taxonomy?symbols=${encodeURIComponent(names.join(","))}`, { cache: "no-store" });
      const body = (await response.json()) as {
        ok?: boolean;
        taxonomy?: Record<string, { sector?: string | null; revenueGeoBucket?: string | null; source?: string | null; updatedAt?: string | null }>;
      };
      if (!body.ok || !body.taxonomy) {
        setExposures(names.map((symbol) => sourcedName({ symbol })));
        setExposureNote("Taxonomy did not load. Sector, rates, and geography are blank.");
        return;
      }
      setExposures(names.map((symbol) => {
        const row = body.taxonomy?.[symbol];
        return sourcedName({
          symbol,
          sector: row?.sector,
          sectorSource: row?.source,
          sectorAsOf: row?.updatedAt,
          geography: row?.revenueGeoBucket,
          geographySource: row?.source,
          geographyAsOf: row?.updatedAt,
        });
      }));
      setExposureNote("Values appear only when the local taxonomy row has a source and a date. Demo labels are dropped. Rate exposure is blank because none is stored.");
    } catch {
      setExposures(names.map((symbol) => sourcedName({ symbol })));
      setExposureNote("Taxonomy could not be read. The cells stay blank.");
    }
  }

  const volume = volumeText.trim() === "" ? null : Number(volumeText);
  const bidValue = bid.trim() === "" ? null : Number(bid);
  const askValue = ask.trim() === "" ? null : Number(ask);
  const liquidity = names.map((symbol) => {
    const shares = snapshot.positions.reduce((sum, position) => (position.kind !== "option" && position.symbol === symbol ? sum + position.quantity : sum), 0);
    return positionLiquidity({
      symbol,
      shares,
      averageDailyVolume: volume != null && Number.isFinite(volume) ? volume : null,
      volumeSource: volume != null && Number.isFinite(volume) ? "user-entered average daily share volume" : null,
      volumeAsOf: volume != null && Number.isFinite(volume) ? snapshot.asOf : null,
      bid: bidValue != null && Number.isFinite(bidValue) ? bidValue : null,
      ask: askValue != null && Number.isFinite(askValue) ? askValue : null,
      quoteSource: bidValue != null && askValue != null ? "user-entered bid and ask" : null,
      quoteAsOf: bidValue != null && askValue != null ? snapshot.asOf : null,
    });
  });

  return (
    <div className="mt-4 space-y-4" data-fortress-capabilities="">
      <section className="rounded-lg border border-zinc-400 bg-white p-3 dark:border-zinc-400 dark:bg-zinc-950" data-panel="margin">
        <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Option margin</h3>
        <p className={`mt-1 ${text}`}>{OPTION_MARGIN_SOURCE}. Read {OPTION_MARGIN_SOURCE_DATE}. This is not a Schwab house margin call. Schwab can require more. The broad-index 15% schedule is not used.</p>
        <button type="button" className={`mt-2 px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={onOptionFixture}>Load synthetic uncovered call</button>
        {margin == null ? <p className={`mt-2 ${text}`}>This book has no listed option. Long-stock maintenance stays on the scorecard above.</p> : null}
        {margin?.status === "unknown" ? <p className={`mt-2 ${text}`}>{margin.reason}</p> : null}
        {margin?.status === "known" ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm text-zinc-900 dark:text-zinc-100">
              <caption className={`mb-1 text-left ${muted}`}>Requirement {money(margin.requirement)}. Equity {money(margin.equity)}. Excess {money(margin.excess)}. Source {margin.source}. Date {margin.sourceDate}.</caption>
              <thead>
                <tr>
                  <th className="py-1 pr-3">Line</th>
                  <th className="py-1 pr-3">Amount</th>
                  <th className="py-1">Rule</th>
                </tr>
              </thead>
              <tbody>
                {margin.lines.map((line) => (
                  <tr key={`${line.label}-${line.rule}`} className="border-t border-zinc-400">
                    <th className="py-1 pr-3 font-medium" scope="row">{line.label}</th>
                    <td className="py-1 pr-3 tabular-nums">{money(line.amount)}</td>
                    <td className="py-1">{line.rule}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>

      <section className="rounded-lg border border-zinc-400 bg-white p-3 dark:border-zinc-400 dark:bg-zinc-950" data-panel="shocks">
        <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Tail scenarios</h3>
        <p className={`mt-1 ${text}`}>Each button puts a sourced index decline on the spot path and runs it. The factor is the same for every name. It is not the own history of that name, and it is not an expected-shortfall estimate. An adjusted-close change for a name is shown only when those bars cover the window.</p>
        <div className="mt-2 flex flex-wrap gap-2">
          {STYLE_SHOCKS.map((shock) => (
            <button key={shock.id} type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => onShock(`1, ${shockFactor(shock).toFixed(4)}`, `${shock.label}. ${shock.source}, ${shock.startDate} ${shock.startLevel} to ${shock.endDate} ${shock.endLevel}.`)}>
              {shock.label}
            </button>
          ))}
        </div>
        <label className={`mt-3 block ${labLabel}`}>
          Gap move, percent
          <span className="mt-1 flex gap-2">
            <input aria-label="Gap percent" className={field} value={gap} onChange={(event) => setGap(event.target.value)} />
            <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => {
              const next = gapFactor(Number(gap));
              if (next.factor == null) return;
              onShock(`1, ${next.factor.toFixed(4)}`, `User-entered gap of ${gap}%. Source is this entry on ${snapshot.asOf}, not a historical close.`);
            }}>Apply gap</button>
          </span>
        </label>
        <ul className={`mt-3 space-y-2 ${text}`}>
          {STYLE_SHOCKS.map((shock) => (
            <li key={shock.id}>
              {shock.label}: index factor {shockFactor(shock).toFixed(4)}. {shock.source}. Observed {shock.observed}. {shock.startDate} close {shock.startLevel} to {shock.endDate} close {shock.endLevel}.
              <ul className="mt-1 list-disc pl-5">
                {names.map((symbol) => {
                  const replay = replayAdjusted(series?.find((item) => item.symbol === symbol)?.bars ?? null, shock.startDate, shock.endDate);
                  return <li key={symbol}>{symbol}: {replay.status === "known" ? `own adjusted factor ${replay.factor?.toFixed(4)} from ${replay.startDate} to ${replay.endDate}. Source ${replay.source}.` : "own history blank."}</li>;
                })}
              </ul>
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-zinc-400 bg-white p-3 dark:border-zinc-400 dark:bg-zinc-950" data-panel="liquidity">
        <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Liquidity</h3>
        <p className={`mt-1 ${text}`}>Days to liquidate are absolute shares divided by the average daily share volume you enter. Spread cost is absolute shares times half the bid-ask. Empty inputs stay blank. Nothing is estimated.</p>
        <div className="mt-2 grid gap-2 md:grid-cols-3">
          <label className={labLabel}>Average daily volume<input aria-label="Average daily volume" className={field} value={volumeText} onChange={(event) => setVolumeText(event.target.value)} /></label>
          <label className={labLabel}>Bid<input aria-label="Bid" className={field} value={bid} onChange={(event) => setBid(event.target.value)} /></label>
          <label className={labLabel}>Ask<input aria-label="Ask" className={field} value={ask} onChange={(event) => setAsk(event.target.value)} /></label>
        </div>
        <ul className={`mt-2 space-y-1 ${text}`}>
          {liquidity.map((line) => (
            <li key={line.symbol} data-liquidity={line.symbol}>
              {line.symbol}: days {line.daysToLiquidate == null ? "blank" : line.daysToLiquidate.toFixed(2)}{line.volumeSource ? ` (${line.volumeSource}, ${line.volumeAsOf})` : ""}. Spread cost {line.spreadCost == null ? "blank" : money(line.spreadCost)}{line.quoteSource ? ` (${line.quoteSource}, ${line.quoteAsOf})` : ""}. {line.reason ?? ""}
            </li>
          ))}
        </ul>
      </section>

      <section className="rounded-lg border border-zinc-400 bg-white p-3 dark:border-zinc-400 dark:bg-zinc-950" data-panel="exposures">
        <h3 className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">Sourced exposures</h3>
        <p className={`mt-1 ${text}`}>Sector and geography come only from a stored taxonomy row with a source and a date. Rate exposure stays blank. A demo label is not used.</p>
        <button type="button" className={`mt-2 px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => void loadExposures()}>Load sourced taxonomy</button>
        <p className={`mt-2 ${muted}`}>{exposureNote}</p>
        {exposures ? (
          <div className="mt-2 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm text-zinc-900 dark:text-zinc-100">
              <thead>
                <tr>
                  <th className="py-1 pr-3">Name</th>
                  <th className="py-1 pr-3">Sector</th>
                  <th className="py-1 pr-3">Rates</th>
                  <th className="py-1">Geography</th>
                </tr>
              </thead>
              <tbody>
                {exposures.map((row) => (
                  <tr key={row.symbol} className="border-t border-zinc-400">
                    <th className="py-1 pr-3 font-medium" scope="row">{row.symbol}</th>
                    <td className="py-1 pr-3">{row.sector.value ?? "blank"}{row.sector.source ? ` · ${row.sector.source} · ${row.sector.asOf}` : ""}</td>
                    <td className="py-1 pr-3">{row.rates.value ?? "blank"}</td>
                    <td className="py-1">{row.geography.value ?? "blank"}{row.geography.source ? ` · ${row.geography.source} · ${row.geography.asOf}` : ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : null}
      </section>
    </div>
  );
}
