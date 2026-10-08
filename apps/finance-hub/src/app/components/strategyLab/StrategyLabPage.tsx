"use client";

import { useMemo, useState } from "react";

import { usePrivacy } from "@/app/components/PrivacyProvider";
import { LabCharts } from "@/app/components/strategyLab/LabCharts";
import { StructureCard } from "@/app/components/strategyLab/StructureCard";
import { formatExpiryLabel, isoDate, listedStrikes, nearestStrike, type IsoDate } from "@/lib/optionChain/chain";
import { TEMPLATE_CATALOG, type TemplateRequest } from "@/lib/strategyLab/lab";
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
    edit({
      kind: "addStructure",
      expiry: isoDate(expiry),
      request,
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
          <p className="mt-1 max-w-2xl text-sm text-zinc-600 dark:text-zinc-400">
            Analysis only. Compare option structures on a typed underlying. Nothing here places an order.
          </p>
        </div>
        {chain ? (
          <div className="flex items-center gap-2">
            <span className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium tabular-nums dark:border-white/20">
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
              className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-semibold dark:border-white/20"
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
        <label className="text-xs text-zinc-500">
          Underlying
          <input
            value={symbol}
            onChange={(e) => setSymbol(e.target.value.toUpperCase())}
            className="mt-1 block w-32 rounded border border-zinc-300 bg-white px-2 py-1.5 text-sm font-semibold tracking-wide dark:border-white/20 dark:bg-zinc-950"
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
          <span className="pb-1 text-sm tabular-nums text-zinc-600 dark:text-zinc-300">
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
          <section className="grid gap-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-white/10 dark:bg-zinc-950 sm:grid-cols-2 lg:grid-cols-4">
            <label className="text-xs text-zinc-500">
              Rate %
              <input
                type="number"
                step="0.01"
                value={String(Math.round(lab.assumptions.rate * 10000) / 100)}
                onChange={(e) => edit({ kind: "setAssumptions", patch: { rate: Number(e.target.value) / 100 } })}
                className="mt-1 block w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm tabular-nums dark:border-white/20"
              />
            </label>
            <label className="text-xs text-zinc-500">
              Dividend yield %
              <input
                aria-label="Dividend yield percent"
                type="number"
                step="0.01"
                value={String(Math.round(lab.assumptions.dividendYield * 10000) / 100)}
                onChange={(e) =>
                  edit({ kind: "setAssumptions", patch: { dividendYield: Number(e.target.value) / 100 || 0 } })
                }
                className="mt-1 block w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm tabular-nums dark:border-white/20"
              />
              <span className="mt-1 block text-[11px]">
                {chain.dividendYieldHint == null
                  ? "No yield on this feed. Typed value is used; blank stays 0."
                  : `Schwab yield ${yieldText(chain.dividendYieldHint)}. Not applied until you type it.`}
              </span>
            </label>
            <label className="text-xs text-zinc-500">
              IV source
              <select
                value={lab.assumptions.ivSource}
                onChange={(e) =>
                  edit({ kind: "setAssumptions", patch: { ivSource: e.target.value === "feed" ? "feed" : "mid" } })
                }
                className="mt-1 block w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
              >
                <option value="mid">Solve from mid</option>
                <option value="feed">Feed IV</option>
              </select>
            </label>
            <label className="text-xs text-zinc-500">
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
                  className="w-full rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
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
                  className="w-28 rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm tabular-nums dark:border-white/20"
                />
              </span>
            </label>
          </section>

          <div className="flex flex-wrap gap-2">
            {evaluation.horizons.map((horizon) => (
              <a
                key={horizon.id}
                href={`#h-${horizon.id.replace(/[^a-zA-Z0-9-]/g, "-")}`}
                className="rounded-full border border-zinc-300 px-3 py-1 text-xs font-medium dark:border-white/20"
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

          <section className="rounded-xl border border-dashed border-zinc-300 p-4 dark:border-white/20">
            <h2 className="mb-3 text-sm font-semibold">Add a structure</h2>
            <div className="flex flex-wrap items-end gap-2">
              <label className="text-xs text-zinc-500">
                Template
                <select
                  aria-label="Template"
                  value={template}
                  onChange={(e) => setTemplate(e.target.value as TemplateChoice)}
                  className="mt-1 block rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
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
              <label className="text-xs text-zinc-500">
                Expiry
                <select
                  aria-label="New structure expiry"
                  value={expiry}
                  onChange={(e) => {
                    setExpiryPick(e.target.value);
                    setLongStrike("");
                    setShortStrike("");
                  }}
                  className="mt-1 block max-w-56 rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm dark:border-white/20"
                >
                  {chain.expiries.map((item) => (
                    <option key={item.date} value={item.date}>
                      {formatExpiryLabel(item.date)}
                    </option>
                  ))}
                </select>
              </label>
              {needsStrikes ? (
                <label className="text-xs text-zinc-500">
                  {needsShort ? "Long strike" : "Strike"}
                  <select
                    aria-label="Long strike"
                    value={longValue}
                    onChange={(e) => setLongStrike(e.target.value)}
                    className="mt-1 block rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm tabular-nums dark:border-white/20"
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
                <label className="text-xs text-zinc-500">
                  Short strike
                  <select
                    aria-label="Short strike"
                    value={shortValue}
                    onChange={(e) => setShortStrike(e.target.value)}
                    className="mt-1 block rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm tabular-nums dark:border-white/20"
                  >
                    {callStrikes.map((strike) => (
                      <option key={strike} value={strike}>
                        {strike}
                      </option>
                    ))}
                  </select>
                </label>
              ) : null}
              <label className="text-xs text-zinc-500">
                Limit debit
                <input
                  aria-label="Limit debit"
                  type="number"
                  step="0.01"
                  placeholder="mid"
                  value={limit}
                  onChange={(e) => setLimit(e.target.value)}
                  className="mt-1 block w-24 rounded border border-zinc-300 bg-transparent px-2 py-1.5 text-sm tabular-nums dark:border-white/20"
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
              <StructureCard key={row.spec.id} chain={chain} row={row} masked={privacy.masked} onEdit={edit} />
            ))}
          </div>

          <div id="charts">
            <LabCharts evaluation={evaluation} masked={privacy.masked} />
          </div>
        </>
      ) : null}
    </div>
  );
}
