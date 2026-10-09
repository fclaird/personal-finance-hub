"use client";

import { LAB_PALETTE, labControl, labLabel } from "@/lib/strategyLab/palette";
import {
  deltaHighlights,
  highlightFor,
  strikeChoiceLabel,
  type StrikeDelta,
} from "@/lib/strategyLab/strikeDelta";

const INK = "#09090b";

export function StrikeSelect({
  label,
  ariaLabel,
  rows,
  value,
  onChange,
}: {
  label: string;
  ariaLabel: string;
  rows: readonly StrikeDelta[];
  value: string;
  onChange: (strike: number) => void;
}) {
  const marks = deltaHighlights(rows);
  return (
    <label className={`min-w-0 flex-1 ${labLabel}`}>
      {label}
      <select
        aria-label={ariaLabel}
        value={value}
        onChange={(event) => onChange(Number(event.target.value))}
        className={`mt-1 block w-full min-w-44 px-2 py-1.5 text-sm tabular-nums ${labControl}`}
      >
        {rows.map((row) => {
          const highlight = highlightFor(row.strike, marks);
          const style =
            highlight === "75" || highlight === "both"
              ? { backgroundColor: LAB_PALETTE.series[2], color: INK, fontWeight: 700 }
              : highlight === "50"
                ? { backgroundColor: LAB_PALETTE.series[1], color: INK, fontWeight: 700 }
                : undefined;
          return (
            <option key={row.strike} value={String(row.strike)} style={style}>
              {strikeChoiceLabel(row.strike, row.delta, highlight)}
            </option>
          );
        })}
      </select>
    </label>
  );
}

export function DeltaMarkChips({ rows }: { rows: readonly StrikeDelta[] }) {
  const marks = deltaHighlights(rows);
  const seventyFive = rows.find((row) => row.strike === marks.seventyFive);
  const fifty = rows.find((row) => row.strike === marks.fifty);
  if (!seventyFive && !fifty) return null;
  return (
    <p className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold">
      {seventyFive ? (
        <span className="rounded px-1.5 py-0.5" style={{ backgroundColor: LAB_PALETTE.series[2], color: INK }}>
          nearest .75 · {strikeChoiceLabel(seventyFive.strike, seventyFive.delta, null)}
        </span>
      ) : null}
      {fifty ? (
        <span className="rounded px-1.5 py-0.5" style={{ backgroundColor: LAB_PALETTE.series[1], color: INK }}>
          nearest .50 · {strikeChoiceLabel(fifty.strike, fifty.delta, null)}
        </span>
      ) : null}
    </p>
  );
}
