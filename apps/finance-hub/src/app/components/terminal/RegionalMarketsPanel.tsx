"use client";

import { Line, LineChart, ResponsiveContainer } from "recharts";

import { posNegClass } from "@/lib/terminal/colors";
import { SymbolLink } from "@/app/components/SymbolLink";

export type RegionalMarketItem = {
  id: string;
  region: "us" | "jp" | "kr";
  regionLabel: string;
  label: string;
  yahooSymbol: string;
  last: number | null;
  change: number | null;
  changePct: number | null;
  previousClose: number | null;
  reconciled: boolean;
  divergencePct: number | null;
  sources: {
    yahoo: number | null;
    yahooBar: number | null;
    stooq: number | null;
  };
  series: Array<{ date: string; close: number }>;
  session: { headline: string; detail: string; isOpen: boolean };
};

export type RegionalMarketsPayload = {
  updatedAt?: string | null;
  regions?: {
    us?: { headline: string; detail: string; isOpen: boolean };
    jp?: { headline: string; detail: string; isOpen: boolean };
    kr?: { headline: string; detail: string; isOpen: boolean };
  };
  items: RegionalMarketItem[];
};

const PCT2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });

function formatPrice(v: number | null, region: RegionalMarketItem["region"]): string {
  if (v == null || !Number.isFinite(v)) return "—";
  if (region === "jp") return v.toLocaleString(undefined, { maximumFractionDigits: 0 });
  if (region === "kr") return v.toLocaleString(undefined, { maximumFractionDigits: 2 });
  return v.toFixed(2);
}

function ReconcileBadge({ item }: { item: RegionalMarketItem }) {
  if (item.sources.stooq != null && item.sources.yahoo != null) {
    return (
      <span
        className={
          "rounded px-1.5 py-0.5 text-[10px] font-medium " +
          (item.reconciled
            ? "bg-emerald-100 text-emerald-800 dark:bg-emerald-950/50 dark:text-emerald-200"
            : "bg-amber-100 text-amber-900 dark:bg-amber-950/50 dark:text-amber-200")
        }
        title={
          item.reconciled
            ? `Yahoo ${item.sources.yahoo} ≈ Stooq ${item.sources.stooq}`
            : `Sources diverge by ${item.divergencePct?.toFixed(2) ?? "?"}% (Yahoo ${item.sources.yahoo}, Stooq ${item.sources.stooq})`
        }
      >
        {item.reconciled ? "Yahoo+Stooq" : "Check sources"}
      </span>
    );
  }
  return (
    <span
      className="rounded bg-zinc-200 px-1.5 py-0.5 text-[10px] font-medium text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300"
      title={
        item.reconciled
          ? `Yahoo meta ${item.sources.yahoo} ≈ bar ${item.sources.yahooBar}`
          : "Yahoo-only cross-check"
      }
    >
      Yahoo
    </span>
  );
}

export function RegionalMarketsPanel({ payload }: { payload: RegionalMarketsPayload | null }) {
  if (!payload?.items.length) {
    return (
      <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
        Loading US / Japan / Korea futures &amp; index moves from Yahoo Finance and Stooq…
      </div>
    );
  }

  const groups: Array<{ region: RegionalMarketItem["region"]; label: string; items: RegionalMarketItem[] }> = [
    { region: "us", label: "United States", items: [] },
    { region: "jp", label: "Japan", items: [] },
    { region: "kr", label: "Korea", items: [] },
  ];
  for (const item of payload.items) {
    groups.find((g) => g.region === item.region)?.items.push(item);
  }

  return (
    <div className="space-y-4">
      <div className="text-[11px] text-zinc-600 dark:text-zinc-400">
        Cross-referenced from Yahoo Finance + Stooq (no API keys). US E-mini futures include pre/post for aftermarket
        moves.
      </div>
      {groups.map((group) =>
        group.items.length === 0 ? null : (
          <div key={group.region}>
            <div className="mb-2 flex flex-wrap items-center gap-2">
              <div className="text-xs font-semibold uppercase tracking-wide text-zinc-700 dark:text-zinc-200">
                {group.label}
              </div>
              {payload.regions?.[group.region] ? (
                <span
                  className={
                    "text-[10px] font-medium " +
                    (payload.regions[group.region]!.isOpen
                      ? "text-emerald-700 dark:text-emerald-300"
                      : "text-zinc-500 dark:text-zinc-400")
                  }
                >
                  {payload.regions[group.region]!.headline}
                </span>
              ) : null}
            </div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {group.items.map((item) => {
                const pctPts = item.changePct;
                const chartData = item.series.map((p, idx) => ({ idx, c: p.close }));
                const up = pctPts == null ? true : pctPts >= 0;
                const stroke = up ? "#22c55e" : "#ef4444";
                return (
                  <div
                    key={item.id}
                    className="rounded-xl border border-zinc-300 bg-white/70 p-3 dark:border-white/20 dark:bg-black/20"
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div>
                        <div className="text-xs font-medium text-zinc-700 dark:text-zinc-200">{item.label}</div>
                        <div className="font-mono text-sm font-semibold text-zinc-900 dark:text-zinc-100">
                          <SymbolLink symbol={item.yahooSymbol} className="font-mono font-semibold hover:no-underline">
                            {item.yahooSymbol}
                          </SymbolLink>
                        </div>
                      </div>
                      <ReconcileBadge item={item} />
                    </div>
                    <div className="mt-1 grid grid-cols-2 gap-1 text-xs tabular-nums text-zinc-700 dark:text-zinc-300">
                      <div>Last</div>
                      <div className="text-right font-medium">{formatPrice(item.last, item.region)}</div>
                      <div>Chg %</div>
                      <div className={"text-right font-medium " + posNegClass(pctPts)}>
                        {pctPts == null ? "—" : `${pctPts >= 0 ? "+" : ""}${PCT2.format(pctPts)}%`}
                      </div>
                    </div>
                    {chartData.length >= 2 ? (
                      <div className="mt-2 h-24 w-full min-w-0">
                        <ResponsiveContainer width="100%" height="100%" minWidth={64} minHeight={96}>
                          <LineChart data={chartData} margin={{ top: 4, right: 4, left: 0, bottom: 0 }}>
                            <Line type="monotone" dataKey="c" stroke={stroke} strokeWidth={2} dot={false} isAnimationActive={false} />
                          </LineChart>
                        </ResponsiveContainer>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </div>
        ),
      )}
    </div>
  );
}
