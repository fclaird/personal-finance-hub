"use client";

import { useMemo, useRef, useState } from "react";

import { buildChange, EMPTY_DRAFT, type ChangeDraft } from "@/lib/fortress/composer";
import { evaluateFortress, type FortressResult, type PathPoint } from "@/lib/fortress/evaluate";
import { isCurrentRun, syntheticMarginFixture } from "@/lib/fortress/fixtures";
import { applyChangeSet } from "@/lib/fortress/ledger";
import { longStockExcess } from "@/lib/fortress/margin";
import { buildReturnReport, displayedVerdict, weightsFromSnapshot, type ReturnReport, type SeriesBundle } from "@/lib/fortress/returns";
import type { Assumptions, Change, MarketNode, Snapshot } from "@/lib/fortress/types";
import { DEFAULT_ASSUMPTIONS, FORTRESS_MODEL_VERSION, FORTRESS_RULE_VERSION } from "@/lib/fortress/types";
import { buildUserBook } from "@/lib/fortress/userBook";
import { labCard, labControl, labLabel, LAB_PALETTE } from "@/lib/strategyLab/palette";

const field = `mt-1 block w-full px-2 py-1.5 text-sm ${labControl}`;

function show(value: number | null, unit: string): string {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (unit.startsWith("USD")) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
}

function formatCorr(value: number | null): string {
  return value == null || !Number.isFinite(value) ? "unknown" : value.toLocaleString("en-US", { maximumFractionDigits: 3 });
}

function ReturnPanel({ report }: { report: ReturnReport }) {
  const width = 720;
  const height = 220;
  const pad = 36;
  const pairs = report.full.before.filter((pair) => pair.correlation != null);
  const correlations = pairs.map((pair) => pair.correlation ?? 0);
  const low = Math.min(0, ...correlations);
  const high = Math.max(0.05, ...correlations);
  const x = (index: number) => pad + ((index + 0.5) * (width - pad * 2)) / Math.max(1, pairs.length);
  const y = (value: number) => pad + ((high - value) / (high - low)) * (height - pad * 2);
  return (
    <div className="mt-4" data-returns-status={report.gate} data-returns-dates={report.comparisonDates.length} data-returns-lost={report.lostBaselineDates}>
      <h3 className="text-sm font-semibold text-zinc-50">Adjusted returns, same dates for both books</h3>
      <p className={`mt-1 ${labLabel}`}>{report.corporateActions}. Provider {report.provider}, version {report.version}. Benchmark {report.benchmark}.</p>
      <p className="mt-1 text-sm text-zinc-100">{report.tailNote}</p>
      {report.proxyNote ? <p className="mt-1 text-sm text-amber-200">{report.proxyNote}</p> : null}
      <p className="mt-1 text-sm text-zinc-100">
        Common dates {report.comparisonDates.length}. Baseline dates dropped to match the candidate {report.lostBaselineDates}. Included {report.included.join(", ") || "none"}.
      </p>
      {report.excluded.length > 0 ? (
        <ul className="mt-2 list-disc pl-5 text-sm text-zinc-100">
          {report.excluded.map((row) => (
            <li key={row.symbol}>{row.symbol}: {row.reason}, observations {row.observations}</li>
          ))}
        </ul>
      ) : null}
      {pairs.length > 0 ? (
        <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="Full-sample correlations on the common dates" className="mt-3 h-56 w-full">
          <rect width={width} height={height} fill="#09090b" />
          <line x1={pad} x2={width - pad} y1={y(0)} y2={y(0)} stroke={LAB_PALETTE.zero} strokeWidth="1.5" strokeDasharray="4 4" />
          {pairs.map((pair, index) => (
            <g key={`${pair.a}-${pair.b}`}>
              <line x1={x(index)} x2={x(index)} y1={y(0)} y2={y(pair.correlation ?? 0)} stroke={LAB_PALETTE.series[index % LAB_PALETTE.series.length]} strokeWidth="3" />
              <text x={x(index) - 18} y={height - 8} fill={LAB_PALETTE.axis} fontSize="11">{pair.a}/{pair.b}</text>
            </g>
          ))}
          <text x={pad} y="20" fill={LAB_PALETTE.axis} fontSize="13">Before-book correlation on the common dates. The dashed line is zero.</text>
        </svg>
      ) : null}
      <div className="mt-3 grid gap-4 lg:grid-cols-2">
        {([
          ["Full sample", report.full],
          ["Rolling", report.rolling],
          ["Benchmark down", report.benchmarkDown],
        ] as const).map(([title, block]) => (
          <div key={title} className="overflow-x-auto">
          <table className="w-full min-w-[320px] text-left text-sm text-zinc-100">
            <caption className="mb-1 text-left text-xs text-zinc-300">{title}. Status {block.status}. Observations {block.observations}. {block.reason ?? ""}</caption>
            <thead className="text-zinc-200">
              <tr>
                <th className="py-1 pr-2">Book</th>
                <th className="py-1 pr-2">Pair</th>
                <th className="py-1">Correlation</th>
              </tr>
            </thead>
            <tbody>
              {block.before.map((pair) => (
                <tr key={`before-${pair.a}-${pair.b}`} className="border-t border-zinc-700">
                  <td className="py-1 pr-2">Before</td>
                  <td className="py-1 pr-2">{pair.a}/{pair.b}</td>
                  <td className="py-1 tabular-nums">{formatCorr(pair.correlation)} ({pair.observations})</td>
                </tr>
              ))}
              {block.after.map((pair) => (
                <tr key={`after-${pair.a}-${pair.b}`} className="border-t border-zinc-700">
                  <td className="py-1 pr-2">After</td>
                  <td className="py-1 pr-2">{pair.a}/{pair.b}</td>
                  <td className="py-1 tabular-nums">{formatCorr(pair.correlation)} ({pair.observations})</td>
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        ))}
      </div>
      <div className="mt-3 overflow-x-auto">
      <table className="w-full min-w-[520px] text-left text-sm text-zinc-100">
        <caption className="mb-1 text-left text-xs text-zinc-300">Signed risk contribution. Negatives are kept. The row sum equals sigma when the identity holds.</caption>
        <thead className="text-zinc-200">
          <tr>
            <th className="py-1 pr-2">Book</th>
            <th className="py-1 pr-2">Name</th>
            <th className="py-1 pr-2">Weight</th>
            <th className="py-1 pr-2">Contribution</th>
            <th className="py-1">Sigma</th>
          </tr>
        </thead>
        <tbody>
          {(["before", "after"] as const).flatMap((side) => {
            const risk = side === "before" ? report.beforeRisk : report.afterRisk;
            if (risk.status !== "computed") {
              return [
                <tr key={side} className="border-t border-zinc-700">
                  <td className="py-1 pr-2">{side}</td>
                  <td className="py-1 pr-2" colSpan={4}>{risk.reason ?? "unknown"}</td>
                </tr>,
              ];
            }
            return risk.contributions.map((row) => (
              <tr key={`${side}-${row.symbol}`} className="border-t border-zinc-700">
                <td className="py-1 pr-2">{side}</td>
                <td className="py-1 pr-2">{row.symbol}</td>
                <td className="py-1 pr-2 tabular-nums">{formatCorr(risk.weights.find((weight) => weight.symbol === row.symbol)?.weight ?? null)}</td>
                <td className="py-1 pr-2 tabular-nums">{formatCorr(row.contribution)}</td>
                <td className="py-1 tabular-nums">{formatCorr(risk.sigma)}{risk.identity ? "" : " identity failed"}</td>
              </tr>
            ));
          })}
        </tbody>
      </table>
      </div>
      <p className="mt-2 text-sm text-zinc-100">
        Concentration before HHI {formatCorr(report.beforeConcentration.hhi)}, N {formatCorr(report.beforeConcentration.nweight)}, {report.beforeConcentration.status}. After HHI {formatCorr(report.afterConcentration.hhi)}, N {formatCorr(report.afterConcentration.nweight)}, {report.afterConcentration.status}. Covariance {report.covariance?.psd ? "positive semidefinite" : "unknown"}.
      </p>
    </div>
  );
}

function PathChart({ baseline, changed }: { baseline: readonly PathPoint[]; changed: readonly PathPoint[] }) {
  const width = 720;
  const height = 280;
  const pad = 36;
  const values = [...baseline, ...changed].flatMap((point) => [point.nav, point.maintenanceExcess]).filter((value): value is number => value != null);
  const min = Math.min(0, ...values);
  const max = Math.max(1, ...values);
  const x = (index: number, count: number) => pad + (index * (width - pad * 2)) / Math.max(1, count - 1);
  const y = (value: number) => pad + ((max - value) / (max - min)) * (height - pad * 2);
  const line = (points: readonly PathPoint[], read: (point: PathPoint) => number | null) =>
    points
      .map((point, index) => {
        const value = read(point);
        return value == null ? null : `${x(index, points.length)},${y(value)}`;
      })
      .filter((part): part is string => part != null)
      .join(" ");
  return (
    <svg viewBox={`0 0 ${width} ${height}`} role="img" aria-label="NAV and maintenance excess along the shared spot path" className="h-72 w-full">
      <rect width={width} height={height} fill="#09090b" />
      {[0, 0.5, 1].map((t) => (
        <line key={t} x1={pad} x2={width - pad} y1={y(min + (max - min) * t)} y2={y(min + (max - min) * t)} stroke="#71717a" strokeWidth="1" />
      ))}
      <polyline points={line(baseline, (point) => point.nav)} fill="none" stroke="#4ade80" strokeWidth="3" />
      <polyline points={line(changed, (point) => point.nav)} fill="none" stroke="#22d3ee" strokeWidth="3" />
      <polyline points={line(changed, (point) => point.maintenanceExcess)} fill="none" stroke="#fbbf24" strokeWidth="3" />
      {changed.map((point, index) =>
        point.maintenanceExcess != null && point.maintenanceExcess < 0 ? (
          <circle key={point.nodeId} cx={x(index, changed.length)} cy={y(point.maintenanceExcess)} r="5" fill="#fb7185" stroke="#09090b" strokeWidth="2" />
        ) : null,
      )}
      <text x={pad} y="22" fill="#e4e4e7" fontSize="13">
        Green baseline NAV · Cyan changed NAV · Amber maintenance excess
      </text>
      <text x="4" y={y(max)} fill="#e4e4e7" fontSize="12">{Math.round(max)}</text>
      <text x="4" y={y(min)} fill="#e4e4e7" fontSize="12">{Math.round(min)}</text>
    </svg>
  );
}

export function FortressLab() {
  const fixture = useMemo(() => syntheticMarginFixture(), []);
  const [snapshot, setSnapshot] = useState<Snapshot>(fixture.snapshot);
  const [changes, setChanges] = useState<Change[]>([]);
  const [draft, setDraft] = useState<ChangeDraft>(EMPTY_DRAFT);
  const [factors, setFactors] = useState("1, 0.8, 0.5714, 0.5, 1.2");
  const [hike, setHike] = useState("0");
  const [maintenance, setMaintenance] = useState("0.30");
  const [reserve, setReserve] = useState("0");
  const [note, setNote] = useState("Synthetic fixture. Not your household book and not a broker margin call.");
  const [result, setResult] = useState<FortressResult | null>(null);
  const [importNote, setImportNote] = useState<string | null>(null);
  const [lines, setLines] = useState([{ symbol: "", shares: "", price: "" }]);
  const [cashText, setCashText] = useState("0");
  const [debtText, setDebtText] = useState("0");
  const [recordCash, setRecordCash] = useState(false);
  const [recordDebt, setRecordDebt] = useState(false);
  const [maxCorr, setMaxCorr] = useState("");
  const [loadedSeries, setLoadedSeries] = useState<SeriesBundle[] | null>(null);
  const [report, setReport] = useState<ReturnReport | null>(null);
  const [returnNote, setReturnNote] = useState("Adjusted returns are not loaded. A raw close is not used in their place.");
  const run = useRef(0);

  function assumptions(): Assumptions {
    return { ...DEFAULT_ASSUMPTIONS, operationalReserve: Number(reserve) || 0 };
  }

  function spotsOf(book: Snapshot): Record<string, number> {
    return Object.fromEntries(book.positions.filter((position) => position.kind !== "option").map((position) => [position.symbol, position.mark]));
  }

  function reportFor(book: Snapshot, nextChanges: Change[], bundles: SeriesBundle[]): ReturnReport {
    const applied = applyChangeSet(book, nextChanges, assumptions());
    const limit = maxCorr.trim() === "" ? null : Number(maxCorr);
    return buildReturnReport({
      asOf: book.asOf,
      benchmark: "SPY",
      series: bundles,
      before: weightsFromSnapshot(book, spotsOf(book)),
      after: weightsFromSnapshot(applied.snapshot, spotsOf(applied.snapshot)),
      maxAbsCorrelation: limit != null && Number.isFinite(limit) ? limit : null,
    });
  }

  function runModel() {
    const id = ++run.current;
    const path: MarketNode[] = factors.split(",").map((part, index) => ({
      id: `p${index}`,
      date: snapshot.asOf,
      spotFactor: Number(part.trim()),
      volAdd: 0,
      rateAdd: 0,
      houseHike: Number(hike) || 0,
    }));
    if (path.some((node) => !(node.spotFactor > 0))) {
      setNote("Every spot factor must be a positive number.");
      return;
    }
    const maintenanceLong = Number(maintenance);
    const book = { ...snapshot, margin: { ...snapshot.margin, maintenanceLong: Number.isFinite(maintenanceLong) ? maintenanceLong : snapshot.margin.maintenanceLong } };
    const next = evaluateFortress({
      baseline: book,
      changes,
      market: { asOf: book.asOf, spots: spotsOf(book), vols: {}, rate: 0.04, dividendYield: {} },
      path,
      assumptions: assumptions(),
      limits: [{ id: "excess", metric: "maintenanceExcess", limit: 0, direction: "min", required: true }],
    });
    if (!isCurrentRun(id, run.current)) return;
    const nextReport = loadedSeries ? reportFor(book, changes, loadedSeries) : null;
    setReport(nextReport);
    setResult(next);
    setNote(displayedVerdict(next.verdict, nextReport).summary);
  }

  function useTypedBook() {
    const built = buildUserBook({
      asOf: fixture.snapshot.asOf,
      lines: lines.filter((line) => line.symbol.trim()).map((line) => ({ symbol: line.symbol, shares: Number(line.shares), price: Number(line.price) })),
      cash: recordCash ? Number(cashText) : null,
      debt: recordDebt ? Number(debtText) : null,
    });
    if (!built.ok) {
      setNote(built.reason);
      return;
    }
    setSnapshot(built.snapshot);
    setChanges([]);
    setResult(null);
    setReport(null);
    setLoadedSeries(null);
    setReturnNote("Portfolio replaced. Adjusted returns are not loaded for these tickers yet.");
    setNote(built.snapshot.scope.label);
  }

  function addDraft() {
    const built = buildChange(draft, changes.length + 1);
    if (!built.ok) {
      setNote(built.reason);
      return;
    }
    setChanges((prev) => [...prev, built.change]);
  }

  async function importHoldings() {
    const id = ++run.current;
    setImportNote("Reading the exposure rollup. Option contracts are not invented from that rollup.");
    try {
      const response = await fetch("/api/exposure", { cache: "no-store" });
      const body = (await response.json()) as { ok?: boolean; exposure?: { underlyingSymbol: string; heldShares: number; spotMarketValue: number }[] };
      if (!isCurrentRun(id, run.current)) return;
      if (!body.ok || !body.exposure) {
        setImportNote("The exposure rollup did not load. The synthetic book is unchanged.");
        return;
      }
      const positions = body.exposure
        .filter((row) => row.heldShares > 0 && row.underlyingSymbol)
        .map((row) => ({
          id: `imp-${row.underlyingSymbol}`,
          kind: "equity" as const,
          symbol: row.underlyingSymbol.trim().toUpperCase(),
          accountId: "primary",
          quantity: row.heldShares,
          mark: row.spotMarketValue / row.heldShares,
          averageCost: row.spotMarketValue / row.heldShares,
        }));
      setSnapshot({
        ...fixture.snapshot,
        id: "imported-copy",
        scope: { regime: "imported", label: "Share-count copy only. This is not the actual book." },
        completeness: { cash: "missing", debt: "missing", contracts: "share-count-only", quotes: "missing", dividends: "missing" },
        positions,
        cash: [],
        debt: [],
        vintages: { quotes: "missing", model: FORTRESS_MODEL_VERSION, rules: FORTRESS_RULE_VERSION },
      });
      setChanges([]);
      setResult(null);
      setReport(null);
      setLoadedSeries(null);
      setReturnNote("Share-count copy. Adjusted returns are not loaded, and a missing adjclose series will not be filled with the raw close.");
      setImportNote(`${positions.length} share lines copied. Cash, debt, and option contracts were not imported. This is not the actual book, and a comparison cannot pass.`);
    } catch {
      if (isCurrentRun(id, run.current)) setImportNote("The exposure read failed. Nothing was written.");
    }
  }

  function scenarioSymbols(): string[] {
    const symbols = new Set<string>();
    for (const position of snapshot.positions) symbols.add(position.kind === "option" ? position.contract.underlying : position.symbol);
    for (const change of changes) {
      if (change.op === "addEquity" || change.op === "trimEquity") symbols.add(change.symbol);
      if (change.op === "replace") {
        symbols.add(change.sellSymbol);
        symbols.add(change.buySymbol);
      }
      if (change.op === "openOption") symbols.add(change.contract.underlying);
      if (change.op === "roll") symbols.add(change.open.contract.underlying);
    }
    return [...symbols].map((symbol) => symbol.trim().toUpperCase()).filter(Boolean);
  }

  async function loadAdjusted() {
    const id = ++run.current;
    const symbols = scenarioSymbols().filter((symbol) => symbol !== "SYN");
    if (symbols.length === 0) {
      setReturnNote("The open book has no market ticker. Type a portfolio, or add a ticker change, before loading adjusted returns.");
      setReport(null);
      setLoadedSeries(null);
      return;
    }
    setReturnNote("Loading Yahoo adjusted closes once. A missing adjclose array stays empty.");
    try {
      const response = await fetch(`/api/fortress/adjusted-returns?symbols=${encodeURIComponent(symbols.join(","))}&benchmark=SPY`, { cache: "no-store" });
      const body = (await response.json()) as {
        ok?: boolean;
        reason?: string;
        series?: { symbol: string; status: string; bars: { date: string; adjClose: number }[] }[];
      };
      if (!isCurrentRun(id, run.current)) return;
      if (!response.ok || !body.ok || !body.series) {
        setLoadedSeries(null);
        setReport(null);
        setReturnNote(body.reason ?? "Yahoo adjusted closes were not reachable. Nothing was substituted.");
        return;
      }
      const bundles: SeriesBundle[] = body.series.map((row) => ({
        symbol: row.symbol,
        bars: row.status === "ok" ? row.bars : null,
        reason: row.status === "ok" ? undefined : row.status,
      }));
      setLoadedSeries(bundles);
      const next = reportFor(snapshot, changes, bundles);
      setReport(next);
      const gaps = bundles.filter((row) => row.bars == null).map((row) => `${row.symbol} ${row.reason ?? "unavailable"}`);
      setReturnNote(gaps.length ? `Loaded with gaps: ${gaps.join(", ")}. No raw close was substituted.` : next.gateSummary);
    } catch {
      if (!isCurrentRun(id, run.current)) return;
      setLoadedSeries(null);
      setReport(null);
      setReturnNote("Yahoo adjusted closes were not reachable. Nothing was substituted.");
    }
  }

  const heatmap = [1, 0.8, 0.57, 0.5].flatMap((factor) =>
    [0, 0.1, 0.2].map((add) => {
      const maintenanceLong = Number(maintenance) || 0.3;
      const gross = 100_000 * factor;
      const excess = longStockExcess(gross, 40_000, maintenanceLong + add);
      return { factor, add, excess };
    }),
  );

  return (
    <section className={`${labCard} p-4`} data-fortress="">
      <h2 className="text-sm font-semibold text-zinc-50">Fortress simulator</h2>
      <p className={`mt-1 ${labLabel}`}>
        Model {FORTRESS_MODEL_VERSION}. Rules {FORTRESS_RULE_VERSION}, manual maintenance, not a broker calculation. Adjusted-return correlation is loaded only from Yahoo adjclose. Phase 3 tails and phase 4 factors are not computed. No all-clear verdict is issued.
      </p>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => { setSnapshot(fixture.snapshot); setChanges([]); setResult(null); setNote("Synthetic fixture loaded."); }}>
          Load synthetic fixture
        </button>
        <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => void importHoldings()}>
          Copy share counts from the book
        </button>
        <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={runModel}>
          Run comparison
        </button>
        <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => void loadAdjusted()}>
          Load adjusted returns
        </button>
      </div>
      <div className="mt-4 grid gap-3 md:grid-cols-2" data-user-book="">
        {lines.map((line, index) => (
          <div key={index} className="grid grid-cols-[1.2fr_1fr_1fr] gap-2">
            <label className={labLabel}>
              Ticker
              <input aria-label={`Ticker ${index + 1}`} className={field} value={line.symbol} onChange={(event) => setLines((prev) => prev.map((row, rowIndex) => rowIndex === index ? { ...row, symbol: event.target.value.toUpperCase() } : row))} />
            </label>
            <label className={labLabel}>
              Shares
              <input aria-label={`Shares ${index + 1}`} className={field} value={line.shares} onChange={(event) => setLines((prev) => prev.map((row, rowIndex) => rowIndex === index ? { ...row, shares: event.target.value } : row))} />
            </label>
            <label className={labLabel}>
              Price
              <input aria-label={`Price ${index + 1}`} className={field} value={line.price} onChange={(event) => setLines((prev) => prev.map((row, rowIndex) => rowIndex === index ? { ...row, price: event.target.value } : row))} />
            </label>
          </div>
        ))}
        <label className={labLabel}>
          Cash
          <input aria-label="Recorded cash" className={field} value={cashText} onChange={(event) => setCashText(event.target.value)} />
        </label>
        <label className={labLabel}>
          Debt
          <input aria-label="Recorded debt" className={field} value={debtText} onChange={(event) => setDebtText(event.target.value)} />
        </label>
        <label className={`${labLabel} flex items-center gap-2`}>
          <input type="checkbox" className="h-4 w-4 accent-zinc-100" checked={recordCash} onChange={(event) => setRecordCash(event.target.checked)} />
          Record this cash amount, including zero
        </label>
        <label className={`${labLabel} flex items-center gap-2`}>
          <input type="checkbox" className="h-4 w-4 accent-zinc-100" checked={recordDebt} onChange={(event) => setRecordDebt(event.target.checked)} />
          Record this debt amount, including zero
        </label>
        <label className={labLabel}>
          Max absolute correlation
          <input aria-label="Max absolute correlation" className={field} value={maxCorr} placeholder="unset" onChange={(event) => setMaxCorr(event.target.value)} />
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => setLines((prev) => [...prev, { symbol: "", shares: "", price: "" }])}>
          Add ticker line
        </button>
        <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={useTypedBook}>
          Use this portfolio
        </button>
      </div>
      {importNote ? <p className="mt-2 text-sm text-zinc-200">{importNote}</p> : null}
      <div className="mt-4 grid gap-3 md:grid-cols-2">
        <label className={labLabel}>
          Change
          <select aria-label="Change type" className={field} value={draft.op} onChange={(event) => setDraft({ ...draft, op: event.target.value as ChangeDraft["op"] })}>
            {["addEquity", "trimEquity", "replace", "openOption", "closeOption", "roll", "deposit", "withdraw", "borrow", "repay", "transfer", "setMargin"].map((op) => (
              <option key={op} value={op}>{op}</option>
            ))}
          </select>
        </label>
        <label className={labLabel}>
          Symbol or sell symbol
          <input aria-label="Symbol" className={field} value={draft.symbol} onChange={(event) => setDraft({ ...draft, symbol: event.target.value.toUpperCase() })} />
        </label>
        <label className={labLabel}>
          Quantity
          <input aria-label="Quantity" className={field} value={draft.quantity} onChange={(event) => setDraft({ ...draft, quantity: event.target.value })} />
        </label>
        <label className={labLabel}>
          Price or premium
          <input aria-label="Price" className={field} value={draft.price} onChange={(event) => setDraft({ ...draft, price: event.target.value })} />
        </label>
        <label className={labLabel}>
          Cash amount or buy price
          <input aria-label="Amount" className={field} value={draft.amount} onChange={(event) => setDraft({ ...draft, amount: event.target.value })} />
        </label>
        <label className={labLabel}>
          Position id
          <input aria-label="Position id" className={field} value={draft.positionId} onChange={(event) => setDraft({ ...draft, positionId: event.target.value })} />
        </label>
        <label className={labLabel}>
          Right
          <select aria-label="Option right" className={field} value={draft.right} onChange={(event) => setDraft({ ...draft, right: event.target.value === "C" ? "C" : "P" })}>
            <option value="P">Put</option>
            <option value="C">Call</option>
          </select>
        </label>
        <label className={labLabel}>
          Strike and expiry
          <span className="mt-1 flex gap-2">
            <input aria-label="Strike" className={field} value={draft.strike} onChange={(event) => setDraft({ ...draft, strike: event.target.value })} />
            <input aria-label="Expiry" className={field} value={draft.expiry} onChange={(event) => setDraft({ ...draft, expiry: event.target.value })} />
          </span>
        </label>
        <label className={labLabel}>
          Maintenance fraction and cash reserve
          <span className="mt-1 flex gap-2">
            <input aria-label="Maintenance fraction" className={field} value={maintenance} onChange={(event) => setMaintenance(event.target.value)} />
            <input aria-label="Operational reserve" className={field} value={reserve} onChange={(event) => setReserve(event.target.value)} />
          </span>
        </label>
        <label className={labLabel}>
          House hike and spot factors
          <span className="mt-1 flex gap-2">
            <input aria-label="House hike" className={field} value={hike} onChange={(event) => setHike(event.target.value)} />
            <input aria-label="Spot factors" className={field} value={factors} onChange={(event) => setFactors(event.target.value)} />
          </span>
        </label>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={addDraft}>
          Add change
        </button>
        <button type="button" className={`px-3 py-1.5 text-xs font-semibold ${labControl}`} onClick={() => setChanges([])}>
          Clear changes
        </button>
      </div>
      <ul className="mt-3 space-y-1 text-sm text-zinc-100">
        {changes.map((change) => (
          <li key={change.id}>
            {change.id} · {change.op}
          </li>
        ))}
      </ul>
      <p className="mt-3 text-sm text-zinc-100" data-returns-note="">{returnNote}</p>
      {report ? <ReturnPanel report={report} /> : null}
      <p className="mt-3 text-sm font-semibold text-zinc-50" data-fortress-note="" data-fortress-verdict={result ? displayedVerdict(result.verdict, report).kind : "none"}>
        {result ? displayedVerdict(result.verdict, report).summary : note}
      </p>
      <dl className="mt-3 grid gap-2 text-sm text-zinc-100 sm:grid-cols-3" data-ledger="">
        <div>
          <dt className="text-xs text-zinc-300">Settled cash</dt>
          <dd className="tabular-nums" data-ledger-cash="">{(result?.after ?? snapshot).cash.reduce((sum, row) => sum + row.amount, 0).toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-300">Debt principal</dt>
          <dd className="tabular-nums" data-ledger-debt="">{(result?.after ?? snapshot).debt.reduce((sum, row) => sum + row.principal, 0).toLocaleString("en-US")}</dd>
        </div>
        <div>
          <dt className="text-xs text-zinc-300">Economic NAV</dt>
          <dd className="tabular-nums" data-ledger-nav="">{result ? show(result.rows.find((row) => row.id === "nav")?.after ?? null, "USD") : "not run"}</dd>
        </div>
      </dl>
      {snapshot.completeness.contracts !== "recorded" ? (
        <p className="mt-2 text-sm text-amber-200" data-import-incomplete="">
          Share-count copy. Cash, debt, and option contracts are missing, so this is not the actual book.
        </p>
      ) : null}
      {snapshot.scope.regime === "user" && (snapshot.completeness.cash === "missing" || snapshot.completeness.debt === "missing") ? (
        <p className="mt-2 text-sm text-amber-200" data-book-incomplete="">
          Cash or debt was not recorded on this typed portfolio, so the comparison cannot pass.
        </p>
      ) : null}
      {result ? (
        <>
          <div className="mt-4 overflow-x-auto">
            <table className="w-full min-w-[640px] text-left text-sm text-zinc-100">
              <caption className="mb-2 text-left text-xs text-zinc-300">Before and after on one shared path. Units are on each row.</caption>
              <thead className="text-zinc-200">
                <tr>
                  <th className="py-1 pr-3">Metric</th>
                  <th className="py-1 pr-3">Before</th>
                  <th className="py-1 pr-3">After</th>
                  <th className="py-1 pr-3">Diff</th>
                  <th className="py-1">Status</th>
                </tr>
              </thead>
              <tbody>
                {result.rows.map((row) => (
                  <tr key={row.id} className="border-t border-zinc-700">
                    <th className="py-1 pr-3 font-medium" scope="row">{row.label}</th>
                    <td className="py-1 pr-3 tabular-nums">{show(row.before, row.unit)}</td>
                    <td className="py-1 pr-3 tabular-nums">{show(row.after, row.unit)}</td>
                    <td className="py-1 pr-3 tabular-nums">{show(row.diff, row.unit)}</td>
                    <td className="py-1 text-zinc-100" data-status={row.status}>{row.status}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="mt-2 text-xs text-zinc-300">{result.breach.evidence}</p>
          <div className="mt-4 overflow-x-auto rounded-lg border border-zinc-400 bg-zinc-950 p-2">
            <PathChart baseline={result.baselinePath} changed={result.changedPath} />
          </div>
          <div className="mt-4 overflow-x-auto">
            <table className="text-sm text-zinc-100">
              <caption className="mb-2 text-left text-xs text-zinc-300">Synthetic stock maintenance excess at spot factor and house hike. USD, debit 40,000, start value 100,000.</caption>
              <thead>
                <tr>
                  <th className="pr-3 text-left">Factor</th>
                  <th className="pr-3 text-left">Hike</th>
                  <th className="text-left">Excess</th>
                </tr>
              </thead>
              <tbody>
                {heatmap.map((cell) => (
                  <tr key={`${cell.factor}-${cell.add}`}>
                    <td className="pr-3 tabular-nums">{cell.factor}</td>
                    <td className="pr-3 tabular-nums">{cell.add}</td>
                    <td className="tabular-nums">{cell.excess == null ? "unknown" : Math.round(cell.excess).toLocaleString("en-US")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <ul className="mt-4 list-disc pl-5 text-sm text-zinc-200">
            {result.unavailable.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
        </>
      ) : null}
    </section>
  );
}
