"use client";

import { useMemo } from "react";
import { ResponsiveContainer, Tooltip, Treemap } from "recharts";

import { assignEarthToneColorsByLayoutOrder, distinctColorForIndex } from "@/lib/charts/pieEarthTones";
import { formatUsd2, formatUsdCompact } from "@/lib/format";

export type ExposureTreemapLeaf = { symbol: string; marketValue: number };

type TreemapDatum = { name: string; size: number; fill: string };

type Props = {
  leaves: ExposureTreemapLeaf[];
  /** Issuer market cap (USD) from `security_taxonomy.market_cap`. */
  underlyingMarketCapBySymbol: ReadonlyMap<string, number | null>;
  masked: boolean;
  title?: string;
};

function capLookup(map: ReadonlyMap<string, number | null>, symbol: string): number | null {
  const u = symbol.trim().toUpperCase();
  const v = map.get(u) ?? map.get(symbol);
  if (v == null || !Number.isFinite(v) || v <= 0) return null;
  return v;
}

/**
 * Treemap: tile **area ∝ issuer market cap** (only symbols with a positive `market_cap` in taxonomy).
 * Position dollar value is shown in the label for context, not for sizing.
 */
export function ExposurePositionTreemap({ leaves, underlyingMarketCapBySymbol, masked, title }: Props) {
  const { data, omittedWithoutCap } = useMemo(() => {
    const bySym = new Map<string, number>();
    for (const L of leaves) {
      const sym = (L.symbol ?? "").trim().toUpperCase();
      if (!sym || !Number.isFinite(L.marketValue) || L.marketValue <= 0) continue;
      bySym.set(sym, (bySym.get(sym) ?? 0) + L.marketValue);
    }
    const symbols = [...bySym.keys()];
    if (symbols.length === 0) return { data: [] as TreemapDatum[], omittedWithoutCap: 0 };

    let omittedWithoutCap = 0;
    const pairs: Array<{ symbol: string; cap: number; portfolioMv: number }> = [];
    for (const symbol of symbols) {
      const cap = capLookup(underlyingMarketCapBySymbol, symbol);
      const portfolioMv = bySym.get(symbol) ?? 0;
      if (cap == null) {
        omittedWithoutCap += 1;
        continue;
      }
      pairs.push({ symbol, cap, portfolioMv });
    }

    if (pairs.length === 0) return { data: [] as TreemapDatum[], omittedWithoutCap };

    pairs.sort((a, b) => b.cap - a.cap);
    const colorBySym = assignEarthToneColorsByLayoutOrder(pairs.map((p) => p.symbol));

    const raw: TreemapDatum[] = pairs.map(({ symbol, cap, portfolioMv }, i) => ({
      name: `${symbol}\nMcap ${formatUsdCompact(cap, { mask: masked })}\nPos ${formatUsd2(portfolioMv, { mask: masked })}`,
      size: cap,
      fill: colorBySym.get(symbol) ?? distinctColorForIndex(i),
    }));
    return { data: raw, omittedWithoutCap };
  }, [leaves, underlyingMarketCapBySymbol, masked]);

  if (data.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-sm text-zinc-500 dark:border-white/20 dark:text-zinc-400">
        {omittedWithoutCap > 0
          ? "Schwab fundamentals have not returned a market cap for these tickers yet (check Connections), or wait a moment after opening this tab for the sync to finish."
          : "No positions to chart for this view."}
      </div>
    );
  }

  return (
    <div className="space-y-2">
      {title ? <div className="text-sm font-semibold text-zinc-800 dark:text-zinc-100">{title}</div> : null}
      <p className="text-[11px] leading-4 text-zinc-500 dark:text-zinc-400">
        Tile area follows each issuer&apos;s market cap from Schwab fundamentals, stored locally in{" "}
        <span className="font-mono">security_taxonomy.market_cap</span>.
        {omittedWithoutCap > 0
          ? ` ${omittedWithoutCap} holding${omittedWithoutCap === 1 ? "" : "s"} omitted — no market cap in the database for those tickers.`
          : null}
      </p>
      <div className="h-[min(28rem,70vw)] w-full min-h-[16rem] min-w-0">
        <ResponsiveContainer width="100%" height="100%" minHeight={260}>
          <Treemap
            data={data}
            dataKey="size"
            nameKey="name"
            aspectRatio={4 / 3}
            stroke="#18181b"
            isAnimationActive={false}
          >
            <Tooltip
              formatter={(value: number | string | readonly (string | number)[] | undefined) => {
                if (typeof value === "number" && Number.isFinite(value)) return formatUsdCompact(value, { mask: masked });
                if (typeof value === "string") return value;
                return String(value ?? "");
              }}
            />
          </Treemap>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
