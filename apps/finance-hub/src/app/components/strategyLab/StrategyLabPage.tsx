"use client";

import { useCallback, useMemo, useRef, useState } from "react";

import { PAGE_FRAME } from "@/app/components/pageFrame";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { ChainGrid } from "@/app/components/strategyLab/ChainGrid";
import { SpreadOptimizer } from "@/app/components/strategyLab/SpreadOptimizer";
import { LabCharts } from "@/app/components/strategyLab/LabCharts";
import { ExpirySummary } from "@/app/components/strategyLab/ExpirySummary";
import { HeldPositions } from "@/app/components/strategyLab/HeldPositions";
import { ScenarioBar } from "@/app/components/strategyLab/ScenarioBar";
import { DeltaMarkChips, StrikeSelect } from "@/app/components/strategyLab/StrikeSelect";
import { TargetSection } from "@/app/components/strategyLab/TargetBoard";
import { formatExpiryLabel, isoDate, listedStrikes, nearestStrike, type IsoDate, type OptionRight } from "@/lib/optionChain/chain";
import { catalogRequest, describeVolShift, LAB_LIMITS, TEMPLATE_CATALOG, type HorizonSpec, type LabEdit, type TemplateId } from "@/lib/strategyLab/lab";
import type { SpreadCandidate } from "@/lib/strategyLab/callSpreadOptimizer";
import { formatModelDelta, nearestDeltaStrike, strikeDeltas } from "@/lib/strategyLab/strikeDelta";
import { modelAssumptionLabel, underlyingModelIv } from "@/lib/strategyLab/modelAssumptions";
import { labCard, labControl, labLabel } from "@/lib/strategyLab/palette";
import { useStrategyLab } from "@/lib/strategyLab/useStrategyLab";

type TemplateChoice = TemplateId | "zebraDelta";

function strikeCount(template: TemplateChoice): number {
  if (template === "ironCondor") return 4;
  if (template === "ironButterfly" || template === "callButterfly" || template === "putButterfly") return 3;
  if (
    template === "longCall" ||
    template === "longPut" ||
    template === "cashSecuredPut" ||
    template === "syntheticLong" ||
    template === "syntheticShort" ||
    template === "longStraddle" ||
    template === "shortStraddle" ||
    template === "coveredCall" ||
    template === "calendar" ||
    template === "custom"
  ) {
    return 1;
  }
  return 2;
}

function HorizonBar({
  horizons,
  views,
  customDate,
  customMonths,
  onCustomDate,
  onCustomMonths,
  onEdit,
}: {
  horizons: readonly HorizonSpec[];
  views: readonly { id: string; label: string }[];
  customDate: string;
  customMonths: string;
  onCustomDate: (value: string) => void;
  onCustomMonths: (value: string) => void;
  onEdit: (edit: { kind: "setHorizons"; horizons: readonly HorizonSpec[] }) => void;
}) {
  const quartersOn = horizons.some((horizon) => horizon.kind === "quartersToAnchor");
  const halfwayOn = horizons.some((horizon) => horizon.kind === "fractionToAnchor" && horizon.fraction === 0.5);
  const setHorizons = (next: readonly HorizonSpec[]) => onEdit({ kind: "setHorizons", horizons: next });
  const chip = (on: boolean) =>
    `rounded-full px-3 py-1 text-xs font-semibold ${labControl} ${on ? "ring-2 ring-zinc-950 dark:ring-zinc-100" : "opacity-60"}`;

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-end gap-2">
        <button
          type="button"
          aria-pressed={quartersOn}
          className={chip(quartersOn)}
          onClick={() =>
            setHorizons(
              quartersOn
                ? horizons.filter((horizon) => horizon.kind !== "quartersToAnchor")
                : [...horizons, { kind: "quartersToAnchor" }],
            )
          }
        >
          Quarters
        </button>
        <button
          type="button"
          aria-pressed={halfwayOn}
          className={chip(halfwayOn)}
          onClick={() =>
            setHorizons(
              halfwayOn
                ? horizons.filter((horizon) => !(horizon.kind === "fractionToAnchor" && horizon.fraction === 0.5))
                : [...horizons, { kind: "fractionToAnchor", fraction: 0.5 }],
            )
          }
        >
          Halfway
        </button>
        <label className={labLabel}>
          Custom date
          <input
            aria-label="Custom horizon date"
            type="date"
            value={customDate}
            onChange={(event) => onCustomDate(event.target.value)}
            className={`mt-1 block px-2 py-1 text-sm ${labControl}`}
          />
        </label>
        <button
          type="button"
          className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
          onClick={() => {
            if (!/^\d{4}-\d{2}-\d{2}$/.test(customDate)) return;
            setHorizons([...horizons, { kind: "date", date: isoDate(customDate) }]);
          }}
        >
          Add date
        </button>
        <label className={labLabel}>
          Custom months
          <input
            aria-label="Custom horizon months"
            type="number"
            min={1}
            step={1}
            value={customMonths}
            onChange={(event) => onCustomMonths(event.target.value)}
            className={`mt-1 block w-20 px-2 py-1 text-sm tabular-nums ${labControl}`}
          />
        </label>
        <button
          type="button"
          className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
          onClick={() => {
            const months = Number(customMonths);
            if (!Number.isFinite(months) || months <= 0) return;
            setHorizons([...horizons, { kind: "monthsFromEntry", months }]);
          }}
        >
          Add months
        </button>
      </div>
      <div className="flex flex-wrap gap-2">
        {views.map((horizon) => (
          <a
            key={horizon.id}
            href={`#h-${horizon.id.replace(/[^a-zA-Z0-9-]/g, "-")}`}
            className={`rounded-full px-3 py-1 text-xs font-medium ${labControl}`}
          >
            {horizon.label}
          </a>
        ))}
        {horizons.map((horizon, index) =>
          horizon.kind === "quartersToAnchor" ? null : (
            <button
              key={`${horizon.kind}-${index}`}
              type="button"
              className="text-xs font-medium text-zinc-600 underline dark:text-zinc-300"
              onClick={() => setHorizons(horizons.filter((_, item) => item !== index))}
            >
              Remove {horizonChip(horizon)}
            </button>
          ),
        )}
      </div>
    </div>
  );
}

function horizonChip(horizon: HorizonSpec): string {
  if (horizon.kind === "fractionToAnchor") return "halfway";
  if (horizon.kind === "date") return horizon.date;
  if (horizon.kind === "monthsFromEntry") return `+${horizon.months} mo`;
  if (horizon.kind === "entry") return "today";
  if (horizon.kind === "anchorExpiry") return "expiry";
  return "horizon";
}

function ageOf(iso: string): string {
  const ms = Date.now() - Date.parse(iso);
  if (!Number.isFinite(ms) || ms < 0) return "just now";
  const sec = Math.round(ms / 1000);
  if (sec < 60) return `${sec}s`;
  const min = Math.round(sec / 60);
  if (min < 90) return `${min}m`;
  return `${Math.round(min / 60)}h`;
}

export function StrategyLabPage() {
  const privacy = usePrivacy();
  const { chain, lab, evaluation, loading, error, hint, load, edit, replace } = useStrategyLab();
  const [symbol, setSymbol] = useState("NOW");
  const [template, setTemplate] = useState<TemplateChoice>("callDebit");
  const [expiryPick, setExpiryPick] = useState<string>("");
  const [frontPick, setFrontPick] = useState<string>("");
  const [right, setRight] = useState<OptionRight>("C");
  const [longStrike, setLongStrike] = useState("");
  const [shortStrike, setShortStrike] = useState("");
  const [thirdStrike, setThirdStrike] = useState("");
  const [fourthStrike, setFourthStrike] = useState("");
  const [limit, setLimit] = useState("");
  const [capitalDraft, setCapitalDraft] = useState("10000");
  const [targetHorizon, setTargetHorizon] = useState("expiry");
  const [targetText, setTargetText] = useState("");
  const [whatIf, setWhatIf] = useState<{ symbol: string; spot: number } | null>(null);
  const [customDate, setCustomDate] = useState("");
  const [customMonths, setCustomMonths] = useState("9");
  const [longDeltaTarget, setLongDeltaTarget] = useState("75");
  const [shortDeltaTarget, setShortDeltaTarget] = useState("50");
  const [deltaPlotted, setDeltaPlotted] = useState<readonly string[] | null>(null);
  const toggleDelta = useRef<(id: string) => void>(() => {});
  const loadedSpreads = useRef(new Map<string, string>());
  const bindDeltaToggle = useCallback((toggle: (id: string) => void) => {
    toggleDelta.current = toggle;
  }, []);

  const expiry = (expiryPick || chain?.expiries.at(-1)?.date || "") as IsoDate | "";
  const callStrikes = useMemo(() => {
    if (!chain || !expiry) return [];
    return listedStrikes(chain, expiry as IsoDate, "C");
  }, [chain, expiry]);
  const putStrikes = useMemo(() => {
    if (!chain || !expiry) return [];
    return listedStrikes(chain, expiry as IsoDate, "P");
  }, [chain, expiry]);
  const addBoard = useMemo(() => {
    if (!chain || !expiry || !lab) return [];
    return strikeDeltas(chain, expiry as IsoDate, "C", lab.assumptions);
  }, [chain, expiry, lab]);
  const putBoard = useMemo(() => {
    if (!chain || !expiry || !lab) return [];
    return strikeDeltas(chain, expiry as IsoDate, "P", lab.assumptions);
  }, [chain, expiry, lab]);

  const zebraTargets = template === "zebra" || template === "zebraDelta";
  const count = strikeCount(template);
  const putSide =
    template === "shortStrangle" ||
    template === "longStrangle" ||
    template === "riskReversal" ||
    template === "collar" ||
    template === "putDebit" ||
    template === "putCredit" ||
    template === "ironCondor" ||
    template === "putButterfly" ||
    template === "ironButterfly" ||
    template === "longPut" ||
    template === "cashSecuredPut";
  const zebraAuto = template === "zebraDelta" && longStrike === "" && shortStrike === "";
  const autoLong = zebraAuto ? nearestDeltaStrike(addBoard, 0.75, "lower") : null;
  const autoShort = zebraAuto ? nearestDeltaStrike(addBoard, 0.5, "higher") : null;
  const longBoard = putSide ? putBoard : addBoard;
  const secondBoard = template === "ironCondor" || template === "putDebit" || template === "putCredit" || template === "putButterfly" ? putBoard : addBoard;
  const thirdBoard = template === "putButterfly" ? putBoard : addBoard;
  const spot = chain?.spot ?? 0;
  const wingList = template === "putButterfly" ? putStrikes : callStrikes;
  const longFallback =
    autoLong ??
    nearestStrike(
      putSide ? putStrikes : callStrikes,
      template === "ironCondor" ? spot * 0.85 : template === "callButterfly" || template === "putButterfly" || template === "ironButterfly" ? spot * 0.9 : spot,
    );
  const longValue = longStrike || (longFallback != null ? String(longFallback) : "");
  const shortFallback =
    autoShort ??
    nearestStrike(
      template === "ironCondor" || template === "putButterfly" ? putStrikes : callStrikes,
      template === "ironCondor" ? spot * 0.95 : template === "callButterfly" || template === "putButterfly" || template === "ironButterfly" ? spot : spot * 1.1,
    );
  const shortValue = shortStrike || (shortFallback != null ? String(shortFallback) : "");
  const thirdFallback = nearestStrike(thirdBoard === putBoard ? putStrikes : wingList, template === "ironCondor" ? spot * 1.05 : spot * 1.1);
  const thirdValue = thirdStrike || (thirdFallback != null ? String(thirdFallback) : "");
  const fourthFallback = nearestStrike(callStrikes, spot * 1.15);
  const fourthValue = fourthStrike || (fourthFallback != null ? String(fourthFallback) : "");
  const frontExpiry = (frontPick || chain?.expiries.find((item) => item.date < expiry)?.date || chain?.expiries[0]?.date || "") as IsoDate | "";

  function snapAddTargets(longPct: number, shortPct: number) {
    const long = nearestDeltaStrike(addBoard, longPct / 100, "lower");
    const short = nearestDeltaStrike(addBoard, shortPct / 100, "higher");
    if (long != null) setLongStrike(String(long));
    if (short != null) setShortStrike(String(short));
  }

  function addStructure() {
    if (!chain || !expiry) return;
    const choice = template === "zebraDelta" ? "zebra" : template;
    const built = catalogRequest({
      template: choice,
      expiry: isoDate(expiry),
      front: frontExpiry ? isoDate(frontExpiry) : null,
      right,
      strikes: [Number(longValue), Number(shortValue), Number(thirdValue), Number(fourthValue)],
      shortStrangleDelta: template === "shortStrangle" && longStrike === "" && shortStrike === "",
    });
    if ("error" in built) return;
    const limitN = Number(limit);
    const label = TEMPLATE_CATALOG.find((item) => item.id === choice)?.label;
    edit({
      kind: "addStructure",
      expiry: isoDate(expiry),
      request: built,
      label,
      entry: limit.trim() !== "" && Number.isFinite(limitN) ? { kind: "limit", netPerShare: limitN } : { kind: "mid" },
    });
    setLimit("");
  }

  const capital = lab?.basis.kind === "equalCapital" ? lab.basis.capital : Number(capitalDraft) || 10_000;
  const needsStrikes = true;
  const needsShort = count >= 2;
  const needsThird = count >= 3;
  const needsFourth = count >= 4;
  const needsFront = template === "calendar" || template === "diagonal";
  const needsRight = template === "calendar" || template === "diagonal";
  const pickedLong = longBoard.find((row) => String(row.strike) === longValue);
  const pickedShort = secondBoard.find((row) => String(row.strike) === shortValue);

  function addOptimizedSpread(row: SpreadCandidate): boolean {
    if (!lab) return false;
    const existing = loadedSpreads.current.get(row.key);
    if (existing && lab.structures.some((spec) => spec.id === existing)) return true;
    if (lab.structures.length >= LAB_LIMITS.structures) return false;
    const id = `s${lab.seq}`;
    const label = `${Number.isInteger(row.longStrike) ? row.longStrike : row.longStrike.toFixed(2)}/${
      Number.isInteger(row.shortStrike) ? row.shortStrike : row.shortStrike.toFixed(2)
    }`;
    const edits: LabEdit[] = [
      {
        kind: "addStructure",
        label,
        expiry: row.expiry,
        request: {
          template: "callDebitSpread",
          long: { by: "strike", strike: row.longStrike },
          short: { by: "strike", strike: row.shortStrike },
        },
        entry: { kind: "mid" },
      },
      { kind: "setIvOverride", id, legIndex: 0, iv: row.iv },
      { kind: "setIvOverride", id, legIndex: 1, iv: row.iv },
    ];
    loadedSpreads.current.set(row.key, id);
    edit(edits);
    return true;
  }

  function removeOptimizedSpread(key: string) {
    const id = loadedSpreads.current.get(key);
    loadedSpreads.current.delete(key);
    if (id) edit({ kind: "removeStructure", id });
  }

  function addChainLeg(expiryDate: IsoDate, right: OptionRight, strike: number, ratio: number) {
    if (!lab) return;
    const open = lab.structures.find(
      (spec) => spec.expiry === expiryDate && spec.origin?.request.template === "custom" && spec.legs.length < 8,
    );
    if (open) {
      edit({ kind: "addLeg", id: open.id, right, strike, ratio });
      return;
    }
    if (lab.structures.length >= LAB_LIMITS.structures) return;
    edit({
      kind: "addStructure",
      expiry: expiryDate,
      label: "Custom",
      request: { template: "custom", legs: [{ right, strike, ratio }] },
    });
  }

  return (
    <div className={PAGE_FRAME}>
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
                readOnly
                value="4"
                aria-label="Rate percent"
                className="mt-1 block w-full rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm tabular-nums"
              />
            </label>
            <label className={labLabel}>
              Dividend yield %
              <input
                aria-label="Dividend yield percent"
                type="number"
                readOnly
                value="0"
                className="mt-1 block w-full rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm tabular-nums"
              />
              <span className="mt-1 block text-[11px] text-zinc-700 dark:text-zinc-300">{modelAssumptionLabel(underlyingModelIv(chain))}</span>
            </label>
            <label className={labLabel}>
              Vol shift
              <select
                aria-label="Vol shift mode"
                value={lab.assumptions.volShift?.mode ?? "points"}
                onChange={(event) =>
                  edit({
                    kind: "setAssumptions",
                    patch: {
                      volShift: {
                        mode: event.target.value === "pct" ? "pct" : "points",
                        amount: lab.assumptions.volShift?.amount ?? 0,
                      },
                    },
                  })
                }
                className={`mt-1 block px-2 py-1.5 text-sm ${labControl}`}
              >
                <option value="points">Vol points</option>
                <option value="pct">Percent of IV</option>
              </select>
            </label>
            <label className={labLabel}>
              Shift amount
              <input
                aria-label="Vol shift amount"
                type="number"
                step="1"
                value={String(lab.assumptions.volShift?.amount ?? 0)}
                onChange={(event) => {
                  const amount = Number(event.target.value);
                  if (!Number.isFinite(amount)) return;
                  edit({
                    kind: "setAssumptions",
                    patch: { volShift: { mode: lab.assumptions.volShift?.mode ?? "points", amount } },
                  });
                }}
                className={`mt-1 block w-24 px-2 py-1.5 text-sm tabular-nums ${labControl}`}
              />
              {describeVolShift(lab.assumptions.volShift) ? (
                <span className="mt-1 block text-[11px] text-amber-200">{describeVolShift(lab.assumptions.volShift)}</span>
              ) : null}
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
                  value={lab.basis.kind === "matchExpensive" ? "match" : lab.basis.kind === "perPackage" ? "package" : lab.basis.units}
                  onChange={(e) => {
                    const value = e.target.value;
                    if (value === "match") edit({ kind: "setBasis", basis: { kind: "matchExpensive" } });
                    else if (value === "package") edit({ kind: "setBasis", basis: { kind: "perPackage" } });
                    else
                      edit({
                        kind: "setBasis",
                        basis: {
                          kind: "equalCapital",
                          capital: evaluation.match?.capital ?? capital,
                          units: value === "fractional" ? "fractional" : "whole",
                        },
                      });
                  }}
                  className="w-full rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm"
                >
                  <option value="match">Match most expensive</option>
                  <option value="fractional">Manual dollars</option>
                  <option value="whole">Whole contracts</option>
                  <option value="package">Per package</option>
                </select>
                <input
                  aria-label="Capital dollars"
                  type="number"
                  readOnly={lab.basis.kind === "matchExpensive"}
                  value={
                    lab.basis.kind === "equalCapital"
                      ? lab.basis.capital
                      : lab.basis.kind === "matchExpensive"
                        ? (evaluation.match?.capital ?? "")
                        : capitalDraft
                  }
                  onChange={(e) => {
                    if (lab.basis.kind !== "equalCapital") {
                      setCapitalDraft(e.target.value);
                      return;
                    }
                    setCapitalDraft(e.target.value);
                    const next = Number(e.target.value);
                    if (Number.isFinite(next) && next > 0) {
                      edit({ kind: "setBasis", basis: { kind: "equalCapital", capital: next, units: lab.basis.units } });
                    }
                  }}
                  className="w-28 rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm tabular-nums"
                />
              </span>
            </label>
          </section>

          <HorizonBar
            horizons={lab.horizons}
            views={evaluation.horizons}
            customDate={customDate}
            customMonths={customMonths}
            onCustomDate={setCustomDate}
            onCustomMonths={setCustomMonths}
            onEdit={edit}
          />

          <ScenarioBar lab={lab} symbol={chain.symbol} chain={chain} evaluation={evaluation} onRestore={replace} />

          <HeldPositions symbol={chain.symbol} masked={privacy.masked} full={lab.structures.length >= LAB_LIMITS.structures} onImport={edit} />

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
                  onChange={(e) => {
                    const next = e.target.value as TemplateChoice;
                    setTemplate(next);
                    if (next === "zebraDelta") {
                      setLongStrike("");
                      setShortStrike("");
                      setLongDeltaTarget("75");
                      setShortDeltaTarget("50");
                    }
                  }}
                  className="mt-1 block rounded border border-zinc-400 bg-white text-zinc-950 dark:border-zinc-400 dark:bg-zinc-900 dark:text-zinc-50 dark:[color-scheme:dark] px-2 py-1.5 text-sm"
                >
                  {["Debit", "Credit", "Volatility", "Stock", "Calendar", "Custom"].map((group) => (
                    <optgroup key={group} label={group}>
                      {TEMPLATE_CATALOG.filter((item) => item.group === group && item.id !== "zebra").map((item) => (
                        <option key={item.id} value={item.id}>
                          {item.label}
                        </option>
                      ))}
                      {group === "Debit" ? (
                        <>
                          <option value="zebra">ZEBRA strikes</option>
                          <option value="zebraDelta">ZEBRA 75/50</option>
                        </>
                      ) : null}
                    </optgroup>
                  ))}
                </select>
              </label>
              {needsRight ? (
                <label className={labLabel}>
                  Right
                  <select
                    aria-label="Calendar right"
                    value={right}
                    onChange={(e) => setRight(e.target.value === "P" ? "P" : "C")}
                    className={`mt-1 block rounded px-2 py-1.5 text-sm ${labControl}`}
                  >
                    <option value="C">Call</option>
                    <option value="P">Put</option>
                  </select>
                </label>
              ) : null}
              {needsFront ? (
                <label className={labLabel}>
                  Front expiry
                  <select
                    aria-label="Front expiry"
                    value={frontExpiry}
                    onChange={(e) => setFrontPick(e.target.value)}
                    className={`mt-1 block max-w-56 rounded px-2 py-1.5 text-sm ${labControl}`}
                  >
                    {chain.expiries
                      .filter((item) => item.date < expiry)
                      .map((item) => (
                        <option key={item.date} value={item.date}>
                          {formatExpiryLabel(item.date)}
                        </option>
                      ))}
                  </select>
                </label>
              ) : null}
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
                <StrikeSelect
                  label={count === 1 ? "Strike" : putSide ? "Put strike" : "Long strike"}
                  ariaLabel="Long strike"
                  rows={longBoard}
                  value={longValue}
                  onChange={(strike) => setLongStrike(String(strike))}
                />
              ) : null}
              {needsShort ? (
                <StrikeSelect
                  label={template === "ironCondor" ? "Short put" : "Call strike"}
                  ariaLabel="Short strike"
                  rows={secondBoard}
                  value={shortValue}
                  onChange={(strike) => setShortStrike(String(strike))}
                />
              ) : null}
              {needsThird ? (
                <StrikeSelect
                  label={template === "ironCondor" ? "Short call" : "Body"}
                  ariaLabel="Third strike"
                  rows={thirdBoard}
                  value={thirdValue}
                  onChange={(strike) => setThirdStrike(String(strike))}
                />
              ) : null}
              {needsFourth ? (
                <StrikeSelect
                  label="Long call"
                  ariaLabel="Fourth strike"
                  rows={addBoard}
                  value={fourthValue}
                  onChange={(strike) => setFourthStrike(String(strike))}
                />
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
                disabled={lab.structures.length >= LAB_LIMITS.structures}
                className="rounded bg-zinc-950 px-3 py-1.5 text-sm font-semibold text-white disabled:opacity-40 dark:bg-white dark:text-black"
              >
                Add
              </button>
            </div>
            <DeltaMarkChips rows={longBoard} />
            <p className="mt-2 text-[11px] text-zinc-600 dark:text-zinc-300">
              Model delta from the mid, rate, dividend yield, and spot. Approximate.
              {pickedLong?.delta != null ? ` ${putSide ? "Put" : "Long"} actual Δ ${formatModelDelta(pickedLong.delta)}.` : ""}
              {needsShort && pickedShort?.delta != null ? ` Second actual Δ ${formatModelDelta(pickedShort.delta)}.` : ""}
            </p>
            {zebraTargets ? (
              <div className="mt-2 flex flex-wrap items-end gap-2">
                <label className={labLabel}>
                  Long Δ target
                  <input
                    aria-label="ZEBRA long delta target"
                    type="number"
                    min={1}
                    max={99}
                    step={1}
                    value={longDeltaTarget}
                    onChange={(event) => setLongDeltaTarget(event.target.value)}
                    className={`mt-1 block w-20 px-2 py-1 text-sm tabular-nums ${labControl}`}
                  />
                </label>
                <label className={labLabel}>
                  Short Δ target
                  <input
                    aria-label="ZEBRA short delta target"
                    type="number"
                    min={1}
                    max={99}
                    step={1}
                    value={shortDeltaTarget}
                    onChange={(event) => setShortDeltaTarget(event.target.value)}
                    className={`mt-1 block w-20 px-2 py-1 text-sm tabular-nums ${labControl}`}
                  />
                </label>
                <button
                  type="button"
                  className={`px-3 py-1.5 text-xs font-semibold ${labControl}`}
                  onClick={() => snapAddTargets(Number(longDeltaTarget), Number(shortDeltaTarget))}
                >
                  Snap to nearest strike
                </button>
              </div>
            ) : null}
          </section>

          <ChainGrid chain={chain} assumptions={lab.assumptions} onAddLeg={addChainLeg} />

          <SpreadOptimizer
            chain={chain}
            structureCount={lab.structures.length}
            structureLimit={LAB_LIMITS.structures}
            masked={privacy.masked}
            onAdd={addOptimizedSpread}
            onRemove={removeOptimizedSpread}
          />

          <TargetSection
            evaluation={evaluation}
            chain={chain}
            assumptions={lab.assumptions}
            horizonId={evaluation.horizons.some((horizon) => horizon.id === targetHorizon) ? targetHorizon : "expiry"}
            onHorizon={setTargetHorizon}
            targetText={targetText}
            onTargetText={setTargetText}
            masked={privacy.masked}
            plotted={(id) => deltaPlotted == null || deltaPlotted.includes(id)}
            onPlot={(id) => toggleDelta.current(id)}
            onEdit={edit}
          />

          <div id="charts" className="box-border w-full min-w-0 max-w-full space-y-4">
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
              onEdit={edit}
              onDeltaPlot={setDeltaPlotted}
              bindDeltaToggle={bindDeltaToggle}
            />
          </div>
        </>
      ) : null}
    </div>
  );
}
