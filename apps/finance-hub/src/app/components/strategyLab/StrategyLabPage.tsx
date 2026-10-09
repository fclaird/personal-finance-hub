"use client";

import { useMemo, useState } from "react";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import { LabCharts } from "@/app/components/strategyLab/LabCharts";
import { ExpirySummary } from "@/app/components/strategyLab/ExpirySummary";
import { StructureCard } from "@/app/components/strategyLab/StructureCard";
import { formatExpiryLabel, isoDate, listedStrikes, nearestStrike, type IsoDate } from "@/lib/optionChain/chain";
import { bestWhenFor, TEMPLATE_CATALOG, type TemplateRequest } from "@/lib/strategyLab/lab";
import { labCard, labControl, labLabel } from "@/lib/strategyLab/palette";
import { useStrategyLab } from "@/lib/strategyLab/useStrategyLab";

type TemplateChoice = "callDebitSpread" | "zebra" | "zebraDelta" | "longCall" | "custom";

function ageOf(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 90) return `${min}m`;
  return `${Math.round(min / 60)}h`;
}

function yieldText(hint: number): string {
  return `${(hint * 100).toFixed(2)}%`;
}

export function StrategyLabPage() {
  const privacy = usePrivacy();
  const { chain, lab, evaluation, loading, error, hint, load, edit } = useStrategyLab();
  const [symbol, setSymbol] = useState("NOW");
  const [template, setTemplate] = useState<TemplateChoice>("callDebitSpread");
  const [expiryPick, setExpiryPick] = useState<string>("");
  const [longStrike, setLongStrike] = useState("");
  const [shortStrike, setShortStrike] = useState("");
  const [limit, setLimit] = useState("");
  const [capitalDraft, setCapitalDraft] = useState("10000");
  const [whatIf, setWhatIf] = useState<{ symbol: string; spot: number } | null>(null);

  const expiry = (expiryPick || chain?.expiries.at(-1)?.date || "") as IsoDate | "";
  const callStrikes = useMemo(() => {
    if (!chain || !expiry) return [];
    return listedStrikes(chain, expiry as IsoDate, "C");
  }, [chain, expiry]);

  const longValue = longStrike || (nearestStrike(callStrikes, chain?.spot ?? 0)?.toString() ?? "");
  const shortValue = shortStrike || (nearestStrike(callStrikes, (chain?.spot ?? 0) * 1.2)?.toString() ?? "");

  function addStructure() {
    if (!chain || !expiry) return;
    const longN = Number(longValue);
    const shortN = Number(shortValue);
    let request: TemplateRequest;
    if (template === "zebraDelta") {
      request = {
        template: "zebra",
        long: { by: "delta", delta: 0.75 },
        short: { by: "delta", delta: 0.5 },
      };
    } else if (template === "longCall") {
      request = { template: "longCall", strike: { by: "strike", strike: longN } };
    } else if (template === "custom") {
      request = {
        template: "custom",
        legs: [
          { right: "C", strike: longN, ratio: 1 },
          { right: "C", strike: shortN, ratio: -1 },
        ],
      };
    } else if (template === "zebra") {
      request = {
        template: "zebra",
        long: { by: "strike", strike: longN },
        short: { by: "strike", strike: shortN },
      };
    } else {
      request = {
        template: "callDebitSpread",
        long: { by: "strike", strike: longN },
        short: { by: "strike", strike: shortN },
      };
    }
    const limitN = Number(limit);
    const zebra = template === "zebra" || template === "zebraDelta";
    edit({
      kind: "addStructure",
      expiry: isoDate(expiry),
      request,
      label: zebra ? "ZEBRA" : undefined,
      entry: limit.trim() !== "" && Number.isFinite(limitN) ? { kind: "limit", netPerShare: limitN } : { kind: "mid" },
    });
    setLimit("");
  }

  const capital = lab?.basis.kind === "equalCapital" ? lab.basis.capital : Number(capitalDraft) || 10_000;
  const needsStrikes = template !== "zebraDelta";
  const needsShort = template === "callDebitSpread" || template === "zebra" || template === "custom";

  return (
    <div className="mx-auto flex w-full max-w-6xl flex-col gap-6 px-4 py-6 sm:px-6">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Strategy Lab</h1>
          <p className="mt-1 max-w-2xl text-sm text-zinc-700 dark:text-zinc-300">
            Analysis only. Compare option structures on a typed underlying. Nothing here places an order.
          </p>
        </div>
        {chain ? (
          <div className="flex items-center gap-2">
            <span className={`rounded-full px-3 py-1 text-xs font-medium tabular-nums ${labControl}`}>
              {chain.provenance.source === "schwab" ? "Schwab" : "Cboe"}
              {" · "}
              {chain.provenance.delayed ? "delayed" : "live"}
              {" · "}
              {ageOf(chain.provenance.fetchedAt)}
              {chain.provenance.servedFrom === "cache" ? " · cache" : ""}
              {chain.provenance.servedFrom === "staleCache" ? " · stale cache" : ""}
            </span>
            <button
              type="button"
              onClick={() => void load(chain.symbol, true)}
              disabled={loading}
              className={`rounded-full px-3 py-1 text-xs font-semibold ${labControl}`}
            >
              {loading ? "Refreshing" : "Refresh"}
            </button>
          </div>
        ) : null}
      </header>

      <form
        className="flex flex-wrap items-end gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          void load(symbol, false);
        }}
      >
        <label className={labLabel}>
          Underlying
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className={`mt-1 block w-32 px-2 py-1.5 text-sm font-semibold tracking-wide ${labControl}`}
            aria-label="Underlying symbol"
          />
        </label>
        <button
          type="submit"
          disabled={loading}
          className="rounded bg-zinc-950 px-3 py-1.5 text-sm font-semibold text-white dark:bg-white dark:text-black"
        >
          {loading ? "Loading" : "Load chain"}
        </button>
        {chain ? (
          <span className="pb-1 text-sm tabular-nums text-zinc-700 dark:text-zinc-200">
            {chain.symbol} spot {chain.spot.toFixed(2)} · {formatExpiryLabel(chain.tradeDate)}
          </span>
        ) : null}
      </form>

      {error ? (
        <p className="text-sm text-rose-600">
          {error}
          {hint ? ` ${hint}` : ""}
        </p>
      ) : null}

      {lab && chain && evaluation ? (
        <>
          <section className={`${labCard} grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4`}>
            <label className={labLabel}>
              Rate %
              <input
                type="number"
                step="0.01"
                value={String(Math.round(lab.assumptions.rate * 10000) / 100)}
                onChange={(e) => edit({ kind: "setAssumptions", patch: { rate: Number(e.target.value) / 100 } })}
                className="mt-1 block w-full rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm tabular-nums"
              />
            </label>
            <label className={labLabel}>
              Dividend yield %
              <input
                aria-label="Dividend yield percent"
                type="number"
                step="0.01"
                value={String(Math.round(lab.assumptions.dividendYield * 10000) / 100)}
                onChange={(e) =>
                  edit({ kind: "setAssumptions", patch: { dividendYield: Number(e.target.value) / 100 || 0 } })
                }
                className="mt-1 block w-full rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm tabular-nums"
              />
              <span className="mt-1 block text-[11px]">
                {chain.dividendYieldHint == null
                  ? "No yield on this feed. Typed value is used; blank stays 0."
                  : `Schwab yield ${yieldText(chain.dividendYieldHint)}. Not applied until you type it.`}
              </span>
            </label>
            <label className={labLabel}>
              IV source
              <select
                value={lab.assumptions.ivSource}
                onChange={(e) =>
                  edit({ kind: "setAssumptions", patch: { ivSource: e.target.value === "feed" ? "feed" : "mid" } })
                }
                className="mt-1 block w-full rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm"
              >
                <option value="mid">Solve from mid</option>
                <option value="feed">Feed IV</option>
              </select>
            </label>
            <label className={labLabel}>
              Capital basis
              <span className="mt-1 flex gap-2">
                <select
                  aria-label="Capital units"
                  value={lab.basis.kind === "perPackage" ? "package" : lab.basis.units}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "package") edit({ kind: "setBasis", basis: { kind: "perPackage" } });
                    else
                      edit({
                        kind: "setBasis",
                        basis: { kind: "equalCapital", capital, units: value === "fractional" ? "fractional" : "whole" },
                      });
                  }}
                  className="w-full rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm"
                >
                  <option value="whole">Whole contracts</option>
                  <option value="fractional">Fractional</option>
                  <option value="package">Per package</option>
                </select>
                <input
                  aria-label="Capital dollars"
                  type="number"
                  value={lab.basis.kind === "equalCapital" ? lab.basis.capital : capitalDraft}
                  onChange={(e) => {
                    setCapitalDraft(e.target.value);
                    const next = Number(e.target.value);
                    if (lab.basis.kind === "equalCapital" && Number.isFinite(next) && next > 0) {
                      edit({ kind: "setBasis", basis: { kind: "equalCapital", capital: next, units: lab.basis.units } });
                    }
                  }}
                  className="w-28 rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm tabular-nums"
                />
              </span>
            </label>
          </section>

          <div className="flex flex-wrap gap-2">
            {evaluation.horizons.map((horizon) => (
              <a
                key={horizon.id}
                href={`#h-${horizon.id.replace(/[^a-zA-Z0-9-]/g, "-")}`}
                className={`rounded-full px-3 py-1 text-xs font-medium ${labControl}`}
              >
                {horizon.label}
              </a>
            ))}
          </div>

          {evaluation.issues.length > 0 ? (
            <ul className="space-y-1 text-sm text-amber-800 dark:text-amber-200">
              {evaluation.issues.map((issue, index) => (
                <li key={`${issue.code}-${index}`}>{issue.message}</li>
              ))}
            </ul>
          ) : null}

          <section className="rounded-xl border border-dashed border-zinc-400 p-4 dark:border-zinc-500">
            <h2 className="mb-3 text-sm font-semibold">Add a structure</h2>
            <div className="flex flex-wrap items-end gap-2">
              <label className={labLabel}>
                Template
                <select
                  aria-label="Template"
                  value={template}
                  onChange={(e) => setTemplate(e.target.value as TemplateChoice)}
                  className="mt-1 block rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm"
                >
                  {TEMPLATE_CATALOG.filter((item) => item.id !== "zebra").map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.label}
                    </option>
                  ))}
                  <option value="zebra">ZEBRA strikes</option>
                  <option value="zebraDelta">ZEBRA 75/50</option>
                </select>
              </label>
              <label className={labLabel}>
                Expiry
                <select
                  aria-label="New structure expiry"
                  value={expiry}
                  onChange={(e) => {
                    setExpiryPick(e.target.value);
                    setLongStrike("");
                    setShortStrike("");
                  }}
                  className="mt-1 block max-w-56 rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm"
                >
                  {chain.expiries.map((item) => (
                    <option key={item.date} value={item.date}>
                      {formatExpiryLabel(item.date)}
                    </option>
                  ))}
                </select>
              </label>
              {needsStrikes ? (
                <label className={labLabel}>
                  {needsShort ? "Long strike" : "Strike"}
                  <select
                    aria-label="Long strike"
                    value={longValue}
                    onChange={(e) => setLongStrike(e.target.value)}
                    className="mt-1 block rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm tabular-nums"
                  >
                    {callStrikes.map((strike) => (
                      <option key={strike} value={strike}>
                        {strike}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              {needsShort ? (
                <label className={labLabel}>
                  Short strike
                  <select
                    aria-label="Short strike"
                    value={shortValue}
                    onChange={(e) => setShortStrike(e.target.value)}
                    className="mt-1 block rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm tabular-nums"
                  >
                    {callStrikes.map((strike) => (
                      <option key={strike} value={strike}>
                        {strike}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className={labLabel}>
                Limit debit
                <input
                  aria-label="Limit debit"
                  type="number"
                  step="0.01"
                  placeholder="mid"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  className="mt-1 block w-24 rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm tabular-nums"
                />
              </label>
              <button
                type="button"
                onClick={addStructure}
                disabled={lab.structures.length >= 4}
                className="rounded bg-zinc-950 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-black"
              >
                Add
              </button>
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-3">
            {evaluation.structures.map((row) => (
              <StructureCard
                key={row.spec.id}
                chain={chain}
                row={row}
                masked={privacy.masked}
                bestWhen={bestWhenFor(evaluation.expiryBoards, row.spec.id)}
                onEdit={edit}
              />
            ))}
          </div>

          <div id="charts" className="space-y-4">
            <ExpirySummary
              evaluation={evaluation}
              masked={privacy.masked}
              compareStock={lab.compareStock}
              whatIfSpot={whatIf && whatIf.symbol === chain.symbol ? whatIf.spot : chain.spot}
              onWhatIf={(spot) => setWhatIf({ symbol: chain.symbol, spot })}
              onEdit={edit}
            />
            <LabCharts
              evaluation={evaluation}
              masked={privacy.masked}
              whatIfSpot={whatIf && whatIf.symbol === chain.symbol ? whatIf.spot : chain.spot}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
