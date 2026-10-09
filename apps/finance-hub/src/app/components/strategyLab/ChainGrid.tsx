"use client";

import { useMemo, useState } from "react";

import { formatExpiryLabel, type IsoDate, type OptionChain, type OptionRight } from "@/lib/optionChain/chain";
import { labControl, labLabel } from "@/lib/strategyLab/palette";
import { formatModelDelta, modelStrike, type DeltaAssumptions } from "@/lib/strategyLab/strikeDelta";

function px(n: number | null): string {
  return n == null ? "—" : n.toFixed(2);
}

function count(n: number | null): string {
  return n == null ? "—" : String(n);
}

function ivText(n: number | null): string {
  return n == null ? "—" : `${(n * 100).toFixed(1)}%`;
}

export function ChainGrid({
  chain,
  assumptions,
  onAddLeg,
}: {
  chain: OptionChain;
  assumptions: DeltaAssumptions;
  onAddLeg: (expiry: IsoDate, right: OptionRight, strike: number, ratio: number) => void;
}) {
  const [picked, setPicked] = useState<string>("");
  const expiry = (chain.expiries.some((item) => item.date === picked) ? picked : (chain.expiries[0]?.date ?? "")) as IsoDate | "";
  const board = useMemo(() => {
    if (!expiry) return [];
    const listed = chain.expiries.find((item) => item.date === expiry);
    if (!listed) return [];
    return listed.strikes.map((row) => ({
      strike: row.strike,
      call: row.call,
      put: row.put,
      callModel: row.call ? modelStrike(chain, expiry as IsoDate, "C", row.strike, assumptions) : null,
      putModel: row.put ? modelStrike(chain, expiry as IsoDate, "P", row.strike, assumptions) : null,
    }));
  }, [assumptions, chain, expiry]);

  return (
    <section className="rounded-xl border border-zinc-600 bg-zinc-950 p-3 text-zinc-100">
      <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="text-sm font-semibold text-zinc-50">Chain</h2>
          <p className="mt-1 max-w-3xl text-[11px] text-zinc-300">
            Analysis only. Ask adds a long leg and bid adds a short leg to a custom structure. Nothing is sent to a broker.
          </p>
        </div>
        <label className={labLabel}>
          Expiry
          <select
            aria-label="Chain expiry"
            value={expiry}
            onChange={(event) => setPicked(event.target.value)}
            className={`mt-1 block max-w-56 px-2 py-1.5 text-sm ${labControl}`}
          >
            {chain.expiries.map((item) => (
              <option key={item.date} value={item.date}>
                {formatExpiryLabel(item.date)}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="max-h-96 overflow-auto rounded-lg border border-zinc-700">
        <table className="w-full min-w-[64rem] border-collapse text-left text-xs">
          <thead className="sticky top-0 z-10 bg-zinc-900 text-zinc-300">
            <tr>
              <th className="px-2 py-1.5 font-semibold" rowSpan={2}>
                Strike
              </th>
              <th className="px-2 py-1 text-center font-semibold text-emerald-300" colSpan={6}>
                Call
              </th>
              <th className="px-2 py-1 text-center font-semibold text-rose-300" colSpan={6}>
                Put
              </th>
            </tr>
            <tr className="text-[10px] uppercase tracking-wide">
              {["Bid", "Ask", "Mid", "IV", "Δ", "OI / Vol", "Bid", "Ask", "Mid", "IV", "Δ", "OI / Vol"].map((heading, index) => (
                <th key={`${heading}-${index}`} className="px-2 py-1 font-semibold">
                  {heading}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {board.map((row) => (
              <tr key={row.strike} className="border-t border-zinc-800 tabular-nums">
                <td className="px-2 py-1 font-semibold text-zinc-50">{row.strike}</td>
                <SideCells
                  quote={row.call}
                  model={row.callModel}
                  onBid={row.call?.bid == null ? null : () => onAddLeg(expiry as IsoDate, "C", row.strike, -1)}
                  onAsk={row.call?.ask == null ? null : () => onAddLeg(expiry as IsoDate, "C", row.strike, 1)}
                  bidLabel={`Short ${row.strike} call at the bid`}
                  askLabel={`Long ${row.strike} call at the ask`}
                />
                <SideCells
                  quote={row.put}
                  model={row.putModel}
                  onBid={row.put?.bid == null ? null : () => onAddLeg(expiry as IsoDate, "P", row.strike, -1)}
                  onAsk={row.put?.ask == null ? null : () => onAddLeg(expiry as IsoDate, "P", row.strike, 1)}
                  bidLabel={`Short ${row.strike} put at the bid`}
                  askLabel={`Long ${row.strike} put at the ask`}
                />
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

function SideCells({
  quote,
  model,
  onBid,
  onAsk,
  bidLabel,
  askLabel,
}: {
  quote: { bid: number | null; ask: number | null; mid: number | null; feedIv: number | null; openInterest: number | null; volume: number | null } | null;
  model: { iv: number; delta: number } | null;
  onBid: (() => void) | null;
  onAsk: (() => void) | null;
  bidLabel: string;
  askLabel: string;
}) {
  const iv = model?.iv ?? quote?.feedIv ?? null;
  return (
    <>
      <td className="px-2 py-1">
        {onBid ? (
          <button type="button" aria-label={bidLabel} onClick={onBid} className="text-rose-300 underline decoration-rose-400/70">
            {px(quote?.bid ?? null)}
          </button>
        ) : (
          px(quote?.bid ?? null)
        )}
      </td>
      <td className="px-2 py-1">
        {onAsk ? (
          <button type="button" aria-label={askLabel} onClick={onAsk} className="text-emerald-300 underline decoration-emerald-400/70">
            {px(quote?.ask ?? null)}
          </button>
        ) : (
          px(quote?.ask ?? null)
        )}
      </td>
      <td className="px-2 py-1 text-zinc-100">{px(quote?.mid ?? null)}</td>
      <td className="px-2 py-1 text-zinc-100">{ivText(iv)}</td>
      <td className="px-2 py-1 text-zinc-100">{model ? formatModelDelta(model.delta) : "—"}</td>
      <td className="px-2 py-1 text-zinc-300">
        {count(quote?.openInterest ?? null)} / {count(quote?.volume ?? null)}
      </td>
    </>
  );
}
