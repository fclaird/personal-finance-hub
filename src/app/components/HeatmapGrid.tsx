"use client";

import Link from "next/link";
import { useMemo, type CSSProperties } from "react";

import { symbolPageHref } from "@/lib/symbolPage";
import { heatmapCellStyle, treemapLabelColor } from "@/lib/terminal/dailyPerfColor";

export type HeatmapItem = {
  symbol: string;
  changePercent: number | null; // fraction (0.01 = 1%)
  marketCap: number | null; // USD
  companyName?: string | null;
};

function clamp(n: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, n));
}

function spanForCap(marketCap: number | null, caps: number[]) {
  if (marketCap == null || !Number.isFinite(marketCap) || marketCap <= 0 || caps.length < 3) return { c: 1, r: 1 };
  // caps: [p50, p75, p90]
  if (marketCap >= caps[2]!) return { c: 3, r: 2 };
  if (marketCap >= caps[1]!) return { c: 2, r: 2 };
  if (marketCap >= caps[0]!) return { c: 2, r: 1 };
  return { c: 1, r: 1 };
}

function changeSortKey(frac: number | null): number {
  if (frac == null || !Number.isFinite(frac)) return Number.NEGATIVE_INFINITY;
  return frac;
}

export function HeatmapGrid({
  items,
  title,
  companyNamesBySymbol,
}: {
  items: HeatmapItem[];
  title?: string;
  companyNamesBySymbol?: Map<string, string>;
}) {
  const caps = useMemo(() => {
    const v = items
      .map((i) => i.marketCap)
      .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0)
      .sort((a, b) => a - b);
    if (v.length < 20) return [] as number[];
    const p = (q: number) => v[Math.floor((v.length - 1) * q)]!;
    return [p(0.5), p(0.75), p(0.9)];
  }, [items]);

  /** Highest % change (signed) first → lowest on the right; missing % last. */
  const sortedItems = useMemo(() => {
    return [...items].sort((a, b) => {
      const da = changeSortKey(a.changePercent);
      const db = changeSortKey(b.changePercent);
      if (db !== da) return db - da;
      const capA = a.marketCap != null && Number.isFinite(a.marketCap) && a.marketCap > 0 ? a.marketCap : 0;
      const capB = b.marketCap != null && Number.isFinite(b.marketCap) && b.marketCap > 0 ? b.marketCap : 0;
      if (capB !== capA) return capB - capA;
      return a.symbol.localeCompare(b.symbol);
    });
  }, [items]);

  return (
    <div className="min-w-0">
      {title ? <div className="mb-2 text-sm font-semibold">{title}</div> : null}
      <div
        className="grid auto-rows-[40px] grid-cols-12 gap-1.5"
        style={{ gridAutoFlow: "dense" }}
      >
        {sortedItems.map((it) => {
          const spans = spanForCap(it.marketCap, caps);
          const style = heatmapCellStyle(it.changePercent);
          const pct = it.changePercent == null ? null : it.changePercent * 100;
          const companyName =
            it.companyName?.trim() || companyNamesBySymbol?.get(it.symbol.toUpperCase())?.trim() || undefined;
          const tip = companyName;
          const href = symbolPageHref(it.symbol);
          const labelColor = treemapLabelColor(it.changePercent);
          return (
            <Link
              key={it.symbol}
              href={href ?? "#"}
              prefetch={false}
              className="min-w-0 rounded-md border px-2 py-1 text-left text-[13px] font-semibold shadow-sm hover:brightness-110 dark:border-white/15"
              style={{
                ...style,
                color: labelColor,
                gridColumn: `span ${Math.max(1, Math.round(spans.c * 1.3))}`,
                gridRow: `span ${Math.max(1, Math.round(spans.r * 1.3))}`,
              }}
              title={tip}
            >
              <div className="truncate">{it.symbol}</div>
              <div className="truncate text-[12px] font-medium opacity-95" style={{ color: labelColor }}>
                {pct == null ? "—" : `${pct >= 0 ? "+" : ""}${pct.toFixed(1)}%`}
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
