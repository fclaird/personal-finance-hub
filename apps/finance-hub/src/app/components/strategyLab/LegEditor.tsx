"use client";

import { findQuote, formatExpiryLabel, type IsoDate, type OptionChain, type OptionRight } from "@/lib/optionChain/chain";
import { bsmGreeks } from "@/lib/options/blackScholes";
import { calendarDaysBetween } from "@/lib/optionChain/chain";
import { resolveLegCost } from "@/lib/strategyLab/entryCost";
import type { Leg } from "@/lib/strategyLab/legs";
import type { LabEdit } from "@/lib/strategyLab/lab";
import { MODEL_DIVIDEND_YIELD, MODEL_RATE, underlyingModelIv } from "@/lib/strategyLab/modelAssumptions";
import { labControl, labLabel } from "@/lib/strategyLab/palette";
import { strikeDeltas, type DeltaAssumptions } from "@/lib/strategyLab/strikeDelta";
import { DeltaMarkChips, StrikeSelect } from "@/app/components/strategyLab/StrikeSelect";

export function LegEditor({
  leg,
  index,
  structureId,
  structureLabel,
  chain,
  assumptions,
  onEdit,
}: {
  leg: Leg;
  index: number;
  structureId: string;
  structureLabel: string;
  chain: OptionChain;
  assumptions: DeltaAssumptions;
  onEdit: (edit: LabEdit) => void;
}) {
  const right: OptionRight = leg.instrument === "put" ? "P" : "C";
  const expiry = leg.expiry ?? chain.expiries[0]?.date ?? null;
  const rows = leg.instrument === "stock" || expiry == null ? [] : strikeDeltas(chain, expiry, right, assumptions);
  const patch = (next: Omit<Extract<LabEdit, { kind: "setLeg" }>, "kind" | "id" | "legIndex">) =>
    onEdit({ kind: "setLeg", id: structureId, legIndex: index, ...next });
  const quote =
    leg.instrument !== "stock" && leg.expiry && leg.right && leg.strike != null
      ? findQuote(chain, leg.expiry, leg.right, leg.strike)
      : null;
  const mark = leg.instrument === "stock" ? chain.spot : quote?.mid ?? null;
  const resolved = resolveLegCost(leg, mark);
  const priceShown = leg.manualPrice ?? leg.bookPrice;
  const dateShown = leg.manualDate ?? leg.bookDate ?? "";
  const source = resolved.source === "manual" ? "Manual" : resolved.source === "book" ? "Book" : "Mark";

  return (
    <div className="mb-2 flex min-w-0 flex-wrap items-end gap-2">
      <label className={labLabel}>
        Instrument
        <select
          aria-label={`${structureLabel} leg ${index + 1} instrument`}
          value={leg.instrument}
          onChange={(event) => {
            const instrument = event.target.value;
            if (instrument === "call" || instrument === "put" || instrument === "stock") patch({ instrument });
          }}
          className={`mt-1 block px-2 py-1.5 text-sm ${labControl}`}
        >
          <option value="call">Call</option>
          <option value="put">Put</option>
          <option value="stock">Stock</option>
        </select>
      </label>
      <label className={labLabel}>
        Side
        <select
          aria-label={`${structureLabel} leg ${index + 1} side`}
          value={leg.side}
          onChange={(event) => patch({ side: event.target.value === "short" ? "short" : "long" })}
          className={`mt-1 block px-2 py-1.5 text-sm ${labControl}`}
        >
          <option value="long">Buy</option>
          <option value="short">Sell</option>
        </select>
      </label>
      <label className={labLabel}>
        Qty
        <input
          aria-label={`${structureLabel} leg ${index + 1} quantity`}
          type="number"
          min={1}
          step={1}
          value={leg.quantity}
          onChange={(event) => {
            const quantity = Number(event.target.value);
            if (Number.isFinite(quantity) && quantity > 0) patch({ quantity });
          }}
          className={`mt-1 block w-20 px-2 py-1.5 text-sm tabular-nums ${labControl}`}
        />
      </label>
      {leg.instrument !== "stock" && expiry ? (
        <>
          <label className={labLabel}>
            Expiry
            <select
              aria-label={`${structureLabel} leg ${index + 1} expiry`}
              value={expiry}
              onChange={(event) => patch({ expiry: event.target.value as IsoDate })}
              className={`mt-1 block max-w-40 px-2 py-1.5 text-sm ${labControl}`}
            >
              {chain.expiries.map((item) => (
                <option key={item.date} value={item.date}>
                  {formatExpiryLabel(item.date)}
                </option>
              ))}
            </select>
          </label>
          <StrikeSelect
            label="Strike"
            ariaLabel={`${structureLabel} leg ${index + 1} strike`}
            rows={rows}
            value={leg.strike == null ? "" : String(leg.strike)}
            onChange={(strike) => onEdit({ kind: "setStrike", id: structureId, legIndex: index, strike })}
          />
          <button
            type="button"
            aria-label={`${structureLabel} leg ${index + 1} down`}
            className={`px-2 py-1.5 text-sm ${labControl}`}
            onClick={() => onEdit({ kind: "stepStrike", id: structureId, legIndex: index, steps: -1 })}
          >
            −
          </button>
          <button
            type="button"
            aria-label={`${structureLabel} leg ${index + 1} up`}
            className={`px-2 py-1.5 text-sm ${labControl}`}
            onClick={() => onEdit({ kind: "stepStrike", id: structureId, legIndex: index, steps: 1 })}
          >
            +
          </button>
          <label className={labLabel}>
            IV %
            <input
              aria-label={`${structureLabel} leg ${index + 1} IV`}
              type="number"
              step="0.1"
              placeholder="auto"
              value={leg.ivOverride == null ? "" : String(Math.round(leg.ivOverride * 1000) / 10)}
              onChange={(event) => {
                const raw = event.target.value.trim();
                const next = Number(raw);
                onEdit({
                  kind: "setIvOverride",
                  id: structureId,
                  legIndex: index,
                  iv: raw === "" || !Number.isFinite(next) ? null : next / 100,
                });
              }}
              className={`mt-1 block w-16 px-2 py-1.5 text-sm tabular-nums ${labControl}`}
            />
          </label>
          <DeltaMarkChips rows={rows} />
        </>
      ) : (
        <p className="pb-2 text-sm font-semibold text-zinc-950 dark:text-zinc-50">
          {leg.entry.price != null ? `at ${leg.entry.price.toFixed(2)}` : "shares"}
        </p>
      )}
      <label className={labLabel}>
        Entry price
        <input
          aria-label={`${structureLabel} leg ${index + 1} entry price`}
          type="number"
          min={0}
          step="0.01"
          value={priceShown == null ? "" : String(priceShown)}
          placeholder={mark != null ? mark.toFixed(2) : "mark"}
          onChange={(event) => {
            const raw = event.target.value.trim();
            if (raw === "") {
              onEdit({ kind: "setLegCost", id: structureId, legIndex: index, manualPrice: null, manualDate: leg.manualDate });
              return;
            }
            const price = Number(raw);
            if (!Number.isFinite(price) || !(price > 0)) return;
            const manualPrice = leg.bookPrice != null && Math.abs(price - leg.bookPrice) < 1e-6 ? null : price;
            onEdit({ kind: "setLegCost", id: structureId, legIndex: index, manualPrice, manualDate: leg.manualDate });
          }}
          className={`mt-1 block w-24 px-2 py-1.5 text-sm tabular-nums ${labControl}`}
        />
      </label>
      <label className={labLabel}>
        Entry date
        <input
          aria-label={`${structureLabel} leg ${index + 1} entry date`}
          type="date"
          value={dateShown}
          onChange={(event) => {
            const value = event.target.value;
            const manualDate = value === "" || value === (leg.bookDate ?? "") ? null : (value as IsoDate);
            onEdit({ kind: "setLegCost", id: structureId, legIndex: index, manualPrice: leg.manualPrice, manualDate });
          }}
          className={`mt-1 block px-2 py-1.5 text-sm tabular-nums ${labControl}`}
        />
      </label>
      <span className="pb-2 text-xs font-semibold text-zinc-100" data-cost-source={resolved.source}>
        {source}
      </span>
      {leg.missingCost && resolved.source === "mark" ? (
        <span className="pb-2 text-xs font-semibold text-amber-200">No book cost</span>
      ) : null}
      {leg.manualPrice != null || leg.manualDate != null ? (
        <button
          type="button"
          aria-label={`${structureLabel} leg ${index + 1} reset entry`}
          className={`px-2 py-1.5 text-xs font-semibold ${labControl}`}
          onClick={() => onEdit({ kind: "setLegCost", id: structureId, legIndex: index, manualPrice: null, manualDate: null })}
        >
          Reset
        </button>
      ) : null}
      <button
        type="button"
        aria-label={`${structureLabel} drop leg ${index + 1}`}
        className={`px-2 py-1.5 text-xs font-semibold ${labControl}`}
        onClick={() => onEdit({ kind: "removeLeg", id: structureId, legIndex: index })}
      >
        Drop
      </button>
      {leg.instrument !== "stock" ? <ModelDelta leg={leg} chain={chain} /> : null}
    </div>
  );
}

function ModelDelta({ leg, chain }: { leg: Leg; chain: OptionChain }) {
  if (leg.right == null || leg.strike == null || leg.expiry == null) return null;
  const iv = leg.ivOverride != null && leg.ivOverride > 0 ? leg.ivOverride : underlyingModelIv(chain);
  if (iv == null) return null;
  const years = calendarDaysBetween(chain.tradeDate, leg.expiry) / 365;
  if (!(years > 1e-8)) return null;
  const delta = bsmGreeks({
    right: leg.right,
    spot: chain.spot,
    strike: leg.strike,
    years,
    rate: MODEL_RATE,
    dividendYield: MODEL_DIVIDEND_YIELD,
    vol: iv,
  }).delta;
  return <span className="pb-2 text-xs tabular-nums text-zinc-300">Δ {delta.toFixed(2)}</span>;
}
