"use client";

import { useMemo, type CSSProperties } from "react";
import { ResponsiveContainer, Treemap } from "recharts";

import type { HeatmapItem } from "@/app/components/HeatmapGrid";
import { symbolPageHref } from "@/lib/symbolPage";
import { treemapFillForChange } from "@/lib/terminal/dailyPerfColor";

type TreemapRow = {
  name: string;
  size: number;
  symbol: string;
  pctFrac: number | null;
  fill: string;
  companyName: string | null;
};

type TreemapPayload = TreemapRow & { children?: TreemapRow[] };

function sortTreemapRowsDesc(rows: TreemapRow[]): TreemapRow[] {
  return [...rows].sort((a, b) => {
    if (b.size !== a.size) return b.size - a.size;
    return a.symbol.localeCompare(b.symbol);
  });
}

function TreemapCell(props: Record<string, unknown>) {
  const { x, y, width, height, name, payload } = props;
  const p = (payload ?? props) as TreemapPayload;
  const x0 = Number(x);
  const y0 = Number(y);
  const w = Number(width);
  const h = Number(height);
  if (!Number.isFinite(w) || w < 2 || !Number.isFinite(h) || h < 2) return null;

  const sym = (p.symbol ?? String(name ?? "").split("\n")[0] ?? "").trim();
  const clipId = `tm-${sym}-${Math.round(x0 * 10)}-${Math.round(y0 * 10)}-${Math.round(w)}-${Math.round(h)}`.replace(/[^a-zA-Z0-9_-]/g, "_");
  const href = symbolPageHref(sym) ?? "#";
  const fill = typeof p.fill === "string" ? p.fill : treemapFillForChange(p.pctFrac ?? null);
  const pctF = p.pctFrac;
  const pctStr =
    pctF == null || !Number.isFinite(pctF) ? "—" : `${pctF * 100 >= 0 ? "+" : ""}${(pctF * 100).toFixed(1)}%`;
  const tip = (p.companyName ?? "").trim() || undefined;
  const tc = "#ffffff";

  const minDim = Math.min(w, h);
  const area = w * h;
  /** Scale type with tile — big tiles get much larger labels. */
  const fsSym = Math.round(Math.max(10, Math.min(24, minDim * 0.15 + Math.sqrt(area) * 0.018)));
  const fsPct = Math.max(9, Math.round(fsSym * 0.8));
  const lineGap = Math.max(3, Math.round(fsSym * 0.15));
  const blockH = fsSym * 1.05 + lineGap + fsPct * 1.05;
  const cx = x0 + w / 2;
  const cy = y0 + h / 2;

  const textStroke = "rgba(0,0,0,0.72)";
  const symStrokeW = Math.max(2, fsSym * 0.14);
  const pctStrokeW = Math.max(1.5, fsPct * 0.12);

  const textStyleSym: CSSProperties = {
    paintOrder: "stroke fill",
    stroke: textStroke,
    strokeWidth: symStrokeW,
  };
  const textStylePct: CSSProperties = {
    paintOrder: "stroke fill",
    stroke: textStroke,
    strokeWidth: pctStrokeW,
  };

  /** Micro tiles: tile + tooltip only (avoids unreadable overlap). */
  if (minDim < 22 || h < 20) {
    return (
      <g>
        <a href={href}>
          {tip ? <title>{tip}</title> : null}
          <rect x={x0} y={y0} width={w} height={h} style={{ fill }} stroke="#09090b" strokeWidth={1} />
        </a>
      </g>
    );
  }

  /** Small tiles: single centered symbol when not enough room for two lines. */
  if (h < blockH + 6 || w < 44) {
    const fsSmall = Math.max(9, Math.min(14, Math.round(minDim * 0.38)));
    const ySmall = cy + fsSmall * 0.35;
    return (
      <g>
        <defs>
          <clipPath id={clipId}>
            <rect x={x0} y={y0} width={w} height={h} rx={1} />
          </clipPath>
        </defs>
        <a href={href}>
          {tip ? <title>{tip}</title> : null}
          <rect x={x0} y={y0} width={w} height={h} style={{ fill }} stroke="#09090b" strokeWidth={1} />
          <g clipPath={`url(#${clipId})`}>
            <text
              x={cx}
              y={ySmall}
              textAnchor="middle"
              fill={tc}
              fontSize={fsSmall}
              fontWeight={800}
              style={{
                paintOrder: "stroke fill",
                stroke: textStroke,
                strokeWidth: Math.max(2, fsSmall * 0.16),
              }}
            >
              {sym}
            </text>
          </g>
        </a>
      </g>
    );
  }

  const ySym = cy - blockH / 2 + fsSym * 0.88;
  const yPct = ySym + lineGap + fsPct * 0.85;

  return (
    <g>
      <defs>
        <clipPath id={clipId}>
          <rect x={x0} y={y0} width={w} height={h} rx={1} />
        </clipPath>
      </defs>
      <a href={href}>
        {tip ? <title>{tip}</title> : null}
        <rect x={x0} y={y0} width={w} height={h} style={{ fill }} stroke="#09090b" strokeWidth={1} />
        <g clipPath={`url(#${clipId})`}>
          <text x={cx} y={ySym} textAnchor="middle" fill={tc} fontSize={fsSym} fontWeight={800} style={textStyleSym}>
            {sym}
          </text>
          <text x={cx} y={yPct} textAnchor="middle" fill={tc} fontSize={fsPct} fontWeight={600} opacity={0.98} style={textStylePct}>
            {pctStr}
          </text>
        </g>
      </a>
    </g>
  );
}

export function TerminalPositionTreemap({
  items,
  mvBySymbol,
  heatView,
  companyNamesBySymbol,
  portfolioSizeCaption,
}: {
  items: HeatmapItem[];
  mvBySymbol: Map<string, number>;
  heatView: "portfolio" | "spy" | "qqq";
  companyNamesBySymbol?: Map<string, string>;
  /** Overrides default portfolio caption when scope / weight controls are active. */
  portfolioSizeCaption?: string | null;
}) {
  const { rows, caption } = useMemo(() => {
    function companyNameFor(it: HeatmapItem): string | null {
      return it.companyName?.trim() || companyNamesBySymbol?.get(it.symbol.toUpperCase())?.trim() || null;
    }
    const list = items.slice(0, 200);

    function capWeight(it: HeatmapItem): number {
      const mc = it.marketCap;
      if (mc != null && Number.isFinite(mc) && mc > 0) return Math.sqrt(mc);
      return 1;
    }

    const firstPass: TreemapRow[] = [];
    for (const it of list) {
      const sym = it.symbol.toUpperCase();
      let size = 0;
      if (heatView === "portfolio") {
        const mv = mvBySymbol.get(sym);
        if (mv != null && Number.isFinite(mv) && mv > 0) size = mv;
      } else {
        size = capWeight(it);
      }
      if (size <= 0) continue;
      const pctFrac = it.changePercent;
      firstPass.push({
        name: sym,
        size,
        symbol: sym,
        pctFrac,
        fill: treemapFillForChange(pctFrac),
        companyName: companyNameFor(it),
      });
    }

    if (firstPass.length > 0) {
      const cap =
        heatView === "portfolio"
          ? (portfolioSizeCaption?.trim() ||
            "Tile area = portfolio market value (synced positions). Color = today’s % change (same scale as heatmap).")
          : "Tile area ∝ √(market cap). Color = today’s % change.";
      return { rows: sortTreemapRowsDesc(firstPass), caption: cap };
    }

    if (heatView === "portfolio") {
      const second: TreemapRow[] = [];
      for (const it of list) {
        const sym = it.symbol.toUpperCase();
        const size = capWeight(it);
        if (size <= 0) continue;
        const pctFrac = it.changePercent;
        second.push({
          name: sym,
          size,
          symbol: sym,
          pctFrac,
          fill: treemapFillForChange(pctFrac),
          companyName: companyNameFor(it),
        });
      }
      return {
        rows: sortTreemapRowsDesc(second),
        caption:
          second.length > 0
            ? "No portfolio overlap in this universe — showing cap-weighted proxy (√cap). Colors still reflect today’s move."
            : "",
      };
    }

    return { rows: [], caption: "" };
  }, [items, mvBySymbol, heatView, companyNamesBySymbol, portfolioSizeCaption]);

  if (rows.length === 0) {
    return (
      <div className="flex h-64 items-center justify-center rounded-lg border border-dashed border-zinc-400/50 bg-zinc-950/30 text-sm text-zinc-500 dark:text-zinc-400">
        No symbols to chart for this view.
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {caption ? <p className="mb-2 text-xs leading-relaxed text-zinc-500 dark:text-zinc-400">{caption}</p> : null}
      <div className="h-72 w-full min-w-0">
        <ResponsiveContainer width="100%" height="100%" minHeight={260}>
          <Treemap
            data={rows}
            dataKey="size"
            nameKey="name"
            aspectRatio={4 / 3}
            stroke="#09090b"
            isAnimationActive={false}
            content={<TreemapCell />}
          />
        </ResponsiveContainer>
      </div>
    </div>
  );
}
