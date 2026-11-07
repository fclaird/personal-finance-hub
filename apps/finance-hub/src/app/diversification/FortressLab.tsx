"use client";

import { useMemo, useRef, useState } from "react";

import { buildChange, EMPTY_DRAFT, type ChangeDraft } from "@/lib/fortress/composer";
import { evaluateFortress, type FortressResult, type PathPoint } from "@/lib/fortress/evaluate";
import { isCurrentRun, syntheticMarginFixture } from "@/lib/fortress/fixtures";
import { longStockExcess } from "@/lib/fortress/margin";
import type { Assumptions, Change, MarketNode, Snapshot } from "@/lib/fortress/types";
import { DEFAULT_ASSUMPTIONS, FORTRESS_MODEL_VERSION, FORTRESS_RULE_VERSION } from "@/lib/fortress/types";
import { labCard, labControl, labLabel } from "@/lib/strategyLab/palette";

const field = `mt-1 block w-full px-2 py-1.5 text-sm ${labControl}`;

function show(value: number | null, unit: string): string {
  if (value == null || !Number.isFinite(value)) return "unknown";
  if (unit.startsWith("USD")) return value.toLocaleString("en-US", { maximumFractionDigits: 0 });
  return value.toLocaleString("en-US", { maximumFractionDigits: 4 });
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
  const run = useRef(0);

  function assumptions(): Assumptions {
    return { ...DEFAULT_ASSUMPTIONS, operationalReserve: Number(reserve) || 0 };
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
      market: { asOf: book.asOf, spots: Object.fromEntries(book.positions.filter((position) => position.kind !== "option").map((position) => [position.symbol, position.mark])), vols: {}, rate: 0.04, dividendYield: {} },
      path,
      assumptions: assumptions(),
      limits: [{ id: "excess", metric: "maintenanceExcess", limit: 0, direction: "min", required: true }],
    });
    if (!isCurrentRun(id, run.current)) return;
    setResult(next);
    setNote(next.verdict.summary);
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
      setImportNote(`${positions.length} share lines copied. Cash, debt, and option contracts were not imported. This is not the actual book, and a comparison cannot pass.`);
    } catch {
      if (isCurrentRun(id, run.current)) setImportNote("The exposure read failed. Nothing was written.");
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
        Phases 1 and 2. Model {FORTRESS_MODEL_VERSION}. Rules {FORTRESS_RULE_VERSION}, manual maintenance, not a broker calculation. Phase 3 tails and phase 4 factors are not computed. No all-clear verdict is issued.
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
      <p className="mt-3 text-sm font-semibold text-zinc-50" data-fortress-note="" data-fortress-verdict={result?.verdict.kind ?? "none"}>
        {note}
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
