"use client";

import { useMemo, useState } from "react";

import { OptimizerDeltaChart } from "@/app/components/strategyLab/OptimizerDeltaChart";
import { formatSignedUsd2, formatUsd2 } from "@/lib/format";
import { formatExpiryLabel, listedStrikes, type IsoDate, type OptionChain } from "@/lib/optionChain/chain";
import {
  OPTIMIZER_HORIZONS,
  SCORE_LABEL,
  expiryForDuration,
  parseWidths,
  pinSelected,
  rankSpreads,
  scanAnchoredCallSpreads,
  scanCallSpreads,
  variationCaption,
  type DurationId,
  type OptimizerHorizonId,
  type ScoreId,
  type SpreadCandidate,
} from "@/lib/strategyLab/callSpreadOptimizer";
import type { DeltaChartSource } from "@/lib/strategyLab/deltaSource";
import type { LabEvaluation } from "@/lib/strategyLab/lab";
import { modelAssumptionLabel, underlyingModelIv } from "@/lib/strategyLab/modelAssumptions";

const COMPARE_LIMIT = 4;

const DURATIONS: readonly { readonly id: DurationId; readonly label: string }[] = [
  { id: "3m", label: "3 month" },
  { id: "6m", label: "6 month" },
  { id: "leaps", label: "Longest / LEAPS" },
  { id: "custom", label: "Custom expiry" },
];

export function SpreadOptimizer({
  chain,
  structureCount,
  structureLimit,
  masked,
  evaluation,
  plottedIds,
  onAdd,
  onRemove,
}: {
  chain: OptionChain;
  structureCount: number;
  structureLimit: number;
  masked: boolean;
  evaluation: LabEvaluation | null;
  plottedIds: readonly string[] | null;
  onAdd: (row: SpreadCandidate) => boolean;
  onRemove: (key: string) => void;
}) {
  const [duration, setDuration] = useState<DurationId>("6m");
  const [custom, setCustom] = useState<IsoDate | "">(chain.expiries[0]?.date ?? "");
  const [widthText, setWidthText] = useState("");
  const [targetText, setTargetText] = useState(String(Math.round(chain.spot * 1.1)));
  const [horizon, setHorizon] = useState<OptimizerHorizonId>("expiry");
  const [score, setScore] = useState<ScoreId>("return");
  const [minOi, setMinOi] = useState("0");
  const [maxSpread, setMaxSpread] = useState("");
  const [picked, setPicked] = useState<readonly string[]>([]);
  const [pickExpiry, setPickExpiry] = useState<IsoDate | "">(chain.expiries.at(-1)?.date ?? "");
  const [pickLong, setPickLong] = useState("");
  const [pickShort, setPickShort] = useState("");
  const [anchor, setAnchor] = useState<{ expiry: IsoDate; longStrike: number; shortStrike: number } | null>(null);
  const [deltaSource, setDeltaSource] = useState<DeltaChartSource>("optimizer");

  const iv = useMemo(() => underlyingModelIv(chain), [chain]);
  const expiry = anchor?.expiry ?? expiryForDuration(chain, duration, custom || null);
  const targetSpot = Number(targetText);
  const pickStrikes = useMemo(() => {
    if (!pickExpiry) return [];
    return listedStrikes(chain, pickExpiry, "C");
  }, [chain, pickExpiry]);
  const longStrike = Number(pickLong);
  const shortChoices = pickStrikes.filter((strike) => strike > longStrike);

  const scan = useMemo(() => {
    if (!expiry || !(targetSpot > 0)) return null;
    const oi = Number(minOi);
    const spreadCap = maxSpread.trim() === "" ? null : Number(maxSpread) / 100;
    const filters = {
      chain,
      expiry,
      minOpenInterest: Number.isFinite(oi) && oi > 0 ? oi : 0,
      maxBidAsk: spreadCap != null && Number.isFinite(spreadCap) && spreadCap > 0 ? spreadCap : null,
      targetSpot,
      horizon,
    };
    if (anchor && anchor.expiry === expiry) {
      return scanAnchoredCallSpreads({ ...filters, longStrike: anchor.longStrike, shortStrike: anchor.shortStrike });
    }
    return scanCallSpreads({ ...filters, widths: parseWidths(widthText) });
  }, [chain, expiry, widthText, minOi, maxSpread, targetSpot, horizon, anchor]);

  const ranked = useMemo(() => (scan ? pinSelected(rankSpreads(scan.rows, score)) : []), [scan, score]);
  const byKey = useMemo(() => new Map(ranked.map((row) => [row.key, row])), [ranked]);
  const chosen = picked.map((key) => byKey.get(key)).filter((row): row is SpreadCandidate => row != null);
  const chartRows = anchor ? ranked : chosen.length > 0 ? chosen : ranked.slice(0, COMPARE_LIMIT);
  const longs = [...new Set(ranked.map((row) => row.longStrike))].sort((a, b) => a - b);
  const shorts = [...new Set(ranked.map((row) => row.shortStrike))].sort((a, b) => a - b);
  const metricValues = ranked.map((row) => row.scores[score]);
  const metricLo = metricValues.length ? Math.min(...metricValues) : 0;
  const metricHi = metricValues.length ? Math.max(...metricValues) : 1;

  function toggle(row: SpreadCandidate) {
    if (picked.includes(row.key)) {
      onRemove(row.key);
      setPicked((prev) => prev.filter((key) => key !== row.key));
      return;
    }
    if (picked.length >= COMPARE_LIMIT) return;
    if (!onAdd(row)) return;
    setPicked((prev) => (prev.includes(row.key) ? prev : [...prev, row.key]));
  }

  return (
    <section id="spread-optimizer" className="box-border min-w-0 max-w-full rounded-xl border border-zinc-600 bg-zinc-950 p-4 text-zinc-100">
      <h2 className="text-sm font-semibold text-zinc-50">Call debit spread optimizer</h2>
      <p className="mt-1 max-w-3xl text-xs text-zinc-300">
        Ranks listed call debit spreads on one vol. {modelAssumptionLabel(iv)} Debits are quoted mids. Nothing here places an order.
      </p>

      <div className="mt-3 rounded-lg border border-zinc-400 bg-zinc-900 p-3" data-manual-spread="">
        <h3 className="text-xs font-semibold text-zinc-100">Start from a spread</h3>
        <p className="mt-1 text-xs text-zinc-300">
          Pick the long strike, short strike, and expiry. The table and the delta chart then show that spread and the listed strikes stepped around it.
        </p>
        <div className="mt-2 flex min-w-0 flex-wrap items-end gap-2">
          <label className="text-xs text-zinc-300">
            Expiry
            <select
              aria-label="Picked spread expiry"
              value={pickExpiry}
              onChange={(event) => {
                setPickExpiry(event.target.value as IsoDate);
                setPickLong("");
                setPickShort("");
              }}
              className="mt-1 block max-w-full rounded border border-zinc-400 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-50"
            >
              {chain.expiries.map((item) => (
                <option key={item.date} value={item.date}>
                  {formatExpiryLabel(item.date)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-300">
            Long strike
            <select
              aria-label="Picked long strike"
              value={pickLong}
              onChange={(event) => {
                setPickLong(event.target.value);
                if (Number(pickShort) <= Number(event.target.value)) setPickShort("");
              }}
              className="mt-1 block rounded border border-zinc-400 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-50"
            >
              <option value="">Choose</option>
              {pickStrikes.map((strike) => (
                <option key={strike} value={strike}>
                  {strikeText(strike)}
                </option>
              ))}
            </select>
          </label>
          <label className="text-xs text-zinc-300">
            Short strike
            <select
              aria-label="Picked short strike"
              value={pickShort}
              onChange={(event) => setPickShort(event.target.value)}
              className="mt-1 block rounded border border-zinc-400 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-50"
            >
              <option value="">Choose</option>
              {shortChoices.map((strike) => (
                <option key={strike} value={strike}>
                  {strikeText(strike)}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            disabled={!(longStrike > 0) || !(Number(pickShort) > longStrike)}
            onClick={() => {
              if (!pickExpiry || !(longStrike > 0) || !(Number(pickShort) > longStrike)) return;
              setAnchor({ expiry: pickExpiry, longStrike, shortStrike: Number(pickShort) });
              setPicked([]);
            }}
            className="rounded-full bg-zinc-100 px-3 py-1.5 text-xs font-semibold text-zinc-950 disabled:opacity-40"
          >
            Use this spread
          </button>
          {anchor ? (
            <button
              type="button"
              onClick={() => setAnchor(null)}
              className="rounded-full border border-zinc-400 px-3 py-1.5 text-xs font-semibold text-zinc-100"
            >
              Clear pick
            </button>
          ) : null}
        </div>
        {anchor ? (
          <p className="mt-2 text-xs font-semibold text-amber-200" data-anchor-label="">
            Selected {strikeText(anchor.longStrike)}/{strikeText(anchor.shortStrike)} · {formatExpiryLabel(anchor.expiry)}. Nearby rows shift both strikes or change the width.
          </p>
        ) : (
          <p className="mt-2 text-xs text-zinc-300">No spread picked. The scan below uses duration and width.</p>
        )}
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap items-end gap-2">
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Duration">
          {DURATIONS.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-pressed={duration === item.id}
              onClick={() => setDuration(item.id)}
              className={pill(duration === item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        {duration === "custom" ? (
          <label className="text-xs text-zinc-300">
            Expiry
            <select
              aria-label="Optimizer expiry"
              value={custom}
              onChange={(event) => setCustom(event.target.value as IsoDate)}
              className="mt-1 block max-w-full rounded border border-zinc-400 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-50"
            >
              {chain.expiries.map((item) => (
                <option key={item.date} value={item.date}>
                  {formatExpiryLabel(item.date)}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <p className="pb-1 text-xs text-zinc-300">{expiry ? formatExpiryLabel(expiry) : "No expiry"}</p>
        <label className="text-xs text-zinc-300">
          Strike widths
          <input
            aria-label="Strike widths"
            value={widthText}
            placeholder="all pairs, or 10, 25"
            onChange={(event) => setWidthText(event.target.value)}
            className="mt-1 block w-40 max-w-full rounded border border-zinc-400 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-50"
          />
        </label>
        <label className="text-xs text-zinc-300">
          Target price
          <input
            aria-label="Optimizer target price"
            type="number"
            min={0}
            step="0.01"
            value={targetText}
            onChange={(event) => setTargetText(event.target.value)}
            className="mt-1 block w-28 rounded border border-zinc-400 bg-zinc-900 px-2 py-1.5 text-sm tabular-nums text-zinc-50"
          />
        </label>
        <label className="text-xs text-zinc-300">
          Horizon
          <select
            aria-label="Optimizer horizon"
            value={horizon}
            onChange={(event) => setHorizon(event.target.value as OptimizerHorizonId)}
            className="mt-1 block rounded border border-zinc-400 bg-zinc-900 px-2 py-1.5 text-sm text-zinc-50"
          >
            {OPTIMIZER_HORIZONS.map((item) => (
              <option key={item.id} value={item.id}>
                {item.label}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs text-zinc-300">
          Min open interest
          <input
            aria-label="Minimum open interest"
            type="number"
            min={0}
            step="1"
            value={minOi}
            onChange={(event) => setMinOi(event.target.value)}
            className="mt-1 block w-24 rounded border border-zinc-400 bg-zinc-900 px-2 py-1.5 text-sm tabular-nums text-zinc-50"
          />
        </label>
        <label className="text-xs text-zinc-300">
          Max bid/ask %
          <input
            aria-label="Maximum bid ask percent"
            type="number"
            min={0}
            step="1"
            placeholder="any"
            value={maxSpread}
            onChange={(event) => setMaxSpread(event.target.value)}
            className="mt-1 block w-24 rounded border border-zinc-400 bg-zinc-900 px-2 py-1.5 text-sm tabular-nums text-zinc-50"
          />
        </label>
      </div>

      <div className="mt-3 flex min-w-0 flex-wrap gap-1.5" role="radiogroup" aria-label="Score">
        {(Object.keys(SCORE_LABEL) as ScoreId[]).map((id) => (
          <button key={id} type="button" aria-pressed={score === id} onClick={() => setScore(id)} className={pill(score === id)}>
            {SCORE_LABEL[id]}
          </button>
        ))}
      </div>
      <p className="mt-2 text-[11px] text-zinc-400">
        Leverage now is the model delta today, in shares, times the stock price, divided by the debit. It is not the share count at the short strike. Probability is the
        risk-neutral lognormal chance of finishing above the breakeven, and above the short strike. Compare up to {COMPARE_LIMIT}.{" "}
        {structureCount}/{structureLimit} structure tiles in the lab.
        {scan && scan.skipped > 0 ? ` ${scan.skipped} pairs were dropped by the filters or had no debit.` : ""}
      </p>

      {ranked.length === 0 ? (
        <p className="mt-3 text-sm text-zinc-300">No call debit spreads match this expiry and these filters.</p>
      ) : (
        <>
          <div className="mt-3 min-w-0 max-w-full overflow-x-auto">
            <table className="w-full text-left text-xs text-zinc-100">
              <thead>
                <tr className="text-[11px] uppercase tracking-wide text-zinc-400">
                  <th className="py-1 pr-3 font-semibold">Plot</th>
                  <th className="py-1 pr-3 font-semibold">Strikes</th>
                  <th className="py-1 pr-3 font-semibold">Debit</th>
                  <th className="py-1 pr-3 font-semibold">Max profit</th>
                  <th className="py-1 pr-3 font-semibold">Profit / debit</th>
                  <th className="py-1 pr-3 font-semibold">Breakeven</th>
                  <th className="py-1 pr-3 font-semibold">POP</th>
                  <th className="py-1 pr-3 font-semibold">P(short)</th>
                  <th className="py-1 pr-3 font-semibold">E[P&L]</th>
                  <th className="py-1 pr-3 font-semibold">Return at target</th>
                  <th className="py-1 pr-3 font-semibold">Theta / day</th>
                  <th className="py-1 pr-3 font-semibold">Vega</th>
                  <th className="py-1 pr-3 font-semibold">Bid/ask</th>
                  <th className="py-1 pr-3 font-semibold">OI</th>
                  <th className="py-1 pr-3 font-semibold">Long Δ</th>
                  <th className="py-1 pr-3 font-semibold">Short Δ</th>
                  <th className="py-1 pr-3 font-semibold">Net Δ</th>
                  <th className="py-1 font-semibold">Leverage now</th>
                </tr>
              </thead>
              <tbody>
                {ranked.slice(0, 40).map((row, index) => {
                  const on = picked.includes(row.key);
                  return (
                    <tr
                      key={row.key}
                      data-selected={row.selected ? "true" : "false"}
                      className={row.selected ? "border-t border-amber-300 bg-zinc-800" : "border-t border-zinc-700"}
                    >
                      <td className="py-1.5 pr-3">
                        <input
                          type="checkbox"
                          checked={on}
                          aria-label={`Plot ${strikeText(row.longStrike)} ${strikeText(row.shortStrike)} on the delta chart`}
                          onChange={() => toggle(row)}
                        />
                      </td>
                      <td className="py-1.5 pr-3 font-semibold" style={{ color: row.selected ? "#fbbf24" : seriesHint(index) }}>
                        {strikeText(row.longStrike)}/{strikeText(row.shortStrike)}
                        {row.selected ? (
                          <span className="ml-2 rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-bold text-zinc-950">Selected</span>
                        ) : null}
                        {anchor && !row.selected ? (
                          <span className="ml-2 font-medium text-zinc-300">{variationCaption(row.variation, row.variationSteps)}</span>
                        ) : null}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">{money(row.debit, masked)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{signed(row.maxProfit, masked)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.profitToDebit.toFixed(2)}×</td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {row.breakeven.toFixed(2)}
                        <span className="text-zinc-400"> {row.breakevenDistance >= 0 ? "+" : ""}{row.breakevenDistance.toFixed(1)}</span>
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">{pct(row.pop)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{pct(row.probShort)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{signed(row.expectedPnl, masked)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{pct(row.returnAtTarget)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{signed(row.thetaPerDay, masked)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{signed(row.vegaPerPoint, masked)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.bidAskRatio == null ? "—" : pct(row.bidAskRatio)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">
                        {oiText(row.longOpenInterest)}/{oiText(row.shortOpenInterest)}
                      </td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.longDelta.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.shortDelta.toFixed(2)}</td>
                      <td className="py-1.5 pr-3 tabular-nums">{row.netDelta.toFixed(1)}</td>
                      <td className="py-1.5 tabular-nums">{row.leverage.toFixed(2)}×</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          {ranked.length > 40 ? <p className="mt-1 text-[11px] text-zinc-400">Showing the first 40 of {ranked.length}.</p> : null}

          <h3 className="mb-2 mt-4 text-xs font-semibold text-zinc-200">Long strike vs short strike · {SCORE_LABEL[score]}</h3>
          <div className="min-w-0 max-w-full overflow-x-auto">
            <table className="border-collapse text-[11px]">
              <thead>
                <tr>
                  <th className="p-1 text-left font-semibold text-zinc-400">Long \ Short</th>
                  {shorts.map((strike) => (
                    <th key={strike} className="p-1 font-semibold text-zinc-300">
                      {strikeText(strike)}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {longs.map((longStrike) => (
                  <tr key={longStrike}>
                    <th className="p-1 text-left font-semibold text-zinc-300">{strikeText(longStrike)}</th>
                    {shorts.map((shortStrike) => {
                      const row = ranked.find((item) => item.longStrike === longStrike && item.shortStrike === shortStrike);
                      if (!row) return <td key={shortStrike} className="p-1" />;
                      const t = metricHi > metricLo ? (row.scores[score] - metricLo) / (metricHi - metricLo) : 1;
                      return (
                        <td key={shortStrike} className="p-0.5">
                          <button
                            type="button"
                            aria-pressed={picked.includes(row.key)}
                            aria-label={`Load ${strikeText(longStrike)} ${strikeText(shortStrike)}`}
                            onClick={() => toggle(row)}
                            className={`block min-w-14 rounded px-1.5 py-1 tabular-nums text-zinc-950 ${row.selected ? "ring-2 ring-amber-200" : ""}`}
                            style={{ backgroundColor: heat(t) }}
                          >
                            {heatLabel(row, score)}
                          </button>
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

        </>
      )}
      <h3 className="mb-2 mt-4 text-xs font-semibold text-zinc-200">Effective delta as the underlying moves</h3>
      <OptimizerDeltaChart
        rows={chartRows}
        spot={chain.spot}
        years={scan?.years ?? 0}
        tradeDate={chain.tradeDate}
        expiry={expiry}
        preview={!anchor && chosen.length === 0}
        anchored={anchor != null}
        source={deltaSource}
        onSource={setDeltaSource}
        evaluation={evaluation}
        plottedIds={plottedIds}
      />
    </section>
  );
}

function pill(on: boolean): string {
  return `rounded-full px-3 py-1 text-xs font-semibold ${on ? "bg-zinc-100 text-zinc-950" : "border border-zinc-500 text-zinc-100"}`;
}

function strikeText(n: number): string {
  return Number.isInteger(n) ? String(n) : n.toFixed(2);
}

function pct(n: number): string {
  return `${(n * 100).toFixed(1)}%`;
}

function money(n: number, masked: boolean): string {
  return formatUsd2(n, { mask: masked });
}

function signed(n: number, masked: boolean): string {
  return formatSignedUsd2(n, { mask: masked });
}

function oiText(n: number | null): string {
  return n == null ? "—" : String(n);
}

function seriesHint(index: number): string {
  return index < COMPARE_LIMIT ? ["#4ade80", "#22d3ee", "#fbbf24", "#e879f9"][index]! : "#e4e4e7";
}

function heat(t: number): string {
  const light = 18 + Math.min(1, Math.max(0, t)) * 42;
  return `hsl(${150 - t * 40} 70% ${light}%)`;
}

function heatLabel(row: SpreadCandidate, score: ScoreId): string {
  if (score === "return" || score === "probability") return pct(row.scores[score]);
  if (score === "leverage") return `${row.leverage.toFixed(2)}×`;
  return row.scores.delta.toFixed(0);
}
