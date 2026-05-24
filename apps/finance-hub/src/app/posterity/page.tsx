"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";

import { DraggableTileLayout } from "@/app/components/DraggableTileLayout";
import { ExposurePositionTreemap } from "@/app/components/charts/ExposurePositionTreemap";
import { FinancePiePanel } from "@/app/components/FinancePiePanel";
import { SymbolLink } from "@/app/components/SymbolLink";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { formatInt, formatNum, formatUsd2 } from "@/lib/format";
import { formatDisplayDate } from "@/lib/formatDate";
import { POSTERITY_ACCOUNT_IDS } from "@/lib/posterity";
import { symbolPageTargetFromInstrument } from "@/lib/symbolPage";
import { normalizeSectorLabel } from "@/lib/sectorLabel";

type TaxonomyCategory = "sector" | "marketCap" | "revenueGeo";

type TaxonomyRow = {
  sector: string | null;
  industry: string | null;
  marketCap: number | null;
  revenueGeoBucket: string | null;
  source: string | null;
  updatedAt: string;
};

type ExposureRow = {
  underlyingSymbol: string;
  spotMarketValue: number;
  heldShares: number;
  syntheticMarketValue: number;
  syntheticShares: number;
};

type RolledSlice = {
  key: string;
  mv: number;
  weight: number;
  constituents: Array<{ symbol: string; marketValue: number }>;
};

const BTN_CLASSES =
  "flex h-8 w-full min-w-0 items-center justify-center whitespace-nowrap rounded-md px-2 text-xs font-semibold tracking-tight";

async function readApiJson<T extends { ok?: boolean }>(resp: Response): Promise<T> {
  const text = await resp.text();
  if (!text.trim()) throw new Error(`Empty response (${resp.status}) from ${resp.url || "API"}`);
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Non-JSON response (${resp.status}): ${text.slice(0, 240)}`);
  }
}

function posterityAccountButtonLabel(
  id: string,
  meta: { name: string; nickname: string | null } | undefined,
): { primary: string; secondary: string } {
  const secondary = id.replace(/^schwab_/i, "");
  const nick = meta?.nickname?.trim();
  if (nick) return { primary: nick, secondary };
  const name = meta?.name?.trim() ?? "";
  if (name) {
    const primary = name.replace(/^Schwab\s+/i, "").trim() || name;
    return { primary, secondary };
  }
  return { primary: secondary, secondary };
}

function usd2Masked(v: number, masked: boolean) {
  return formatUsd2(v, { mask: masked });
}

function taxonomyBucket(map: Map<string, TaxonomyRow>, sym: string, category: TaxonomyCategory): string {
  const s = (sym ?? "").trim().toUpperCase();
  if (category === "marketCap") return s;
  const t = map.get(s);
  if (!t) return "Unknown";
  if (category === "sector") return normalizeSectorLabel(t.sector);
  return t.revenueGeoBucket ?? "Unknown";
}

function rollupCategory(
  rows: ExposureRow[],
  category: TaxonomyCategory,
  tax: Map<string, TaxonomyRow>,
): { total: number; rows: RolledSlice[] } {
  const m = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const mv = r.spotMarketValue;
    if (mv === 0) continue;
    const k = taxonomyBucket(tax, r.underlyingSymbol, category);
    const sym = r.underlyingSymbol.trim().toUpperCase();
    const inner = m.get(k) ?? new Map<string, number>();
    inner.set(sym, (inner.get(sym) ?? 0) + mv);
    m.set(k, inner);
  }
  const total = Array.from(m.values()).reduce(
    (acc, inner) => acc + Array.from(inner.values()).reduce((a, b) => a + b, 0),
    0,
  );
  const rowsOut = Array.from(m.entries())
    .map(([key, inner]) => {
      const mv = Array.from(inner.values()).reduce((a, b) => a + b, 0);
      const constituents = Array.from(inner.entries())
        .map(([symbol, marketValue]) => ({ symbol, marketValue }))
        .filter((c) => c.marketValue > 0)
        .sort((a, b) => b.marketValue - a.marketValue || a.symbol.localeCompare(b.symbol));
      return { key, mv, weight: total ? mv / total : 0, constituents };
    })
    .sort((a, b) => b.mv - a.mv || a.key.localeCompare(b.key));
  return { total, rows: rowsOut };
}

type PosterityPosition = {
  positionId: string;
  snapshotId: string;
  accountId: string;
  accountName: string;
  accountNickname: string | null;
  securityType: string;
  symbol: string | null;
  underlyingSymbol: string | null;
  optionType: string | null;
  expirationDate: string | null;
  strikePrice: number | null;
  quantity: number | null;
  averagePrice: number | null;
  marketValue: number | null;
};

function symKey(p: PosterityPosition) {
  return (p.underlyingSymbol ?? p.symbol ?? "UNKNOWN").toString().trim().toUpperCase();
}

function formatOptLabel(p: PosterityPosition) {
  const u = (p.underlyingSymbol ?? p.symbol ?? "").toString().trim().toUpperCase();
  const type = (p.optionType ?? "").toString().toUpperCase();
  const exp = p.expirationDate ? formatDisplayDate(p.expirationDate, { fallback: "" }) : "";
  const strike = p.strikePrice != null ? formatNum(p.strikePrice, 2) : "";
  return [u, exp, strike, type].filter(Boolean).join(" ");
}

export default function PosterityPage() {
  const privacy = usePrivacy();
  const [accountId, setAccountId] = useState<(typeof POSTERITY_ACCOUNT_IDS)[number]>(POSTERITY_ACCOUNT_IDS[0]);

  const [positions, setPositions] = useState<PosterityPosition[]>([]);
  const [exposure, setExposure] = useState<ExposureRow[]>([]);
  const [tax, setTax] = useState<Map<string, TaxonomyRow>>(new Map());
  const [posterityAccounts, setPosterityAccounts] = useState<
    Array<{ id: string; name: string; nickname: string | null }>
  >([]);

  const [error, setError] = useState<string | null>(null);
  const [category, setCategory] = useState<TaxonomyCategory>("sector");

  useEffect(() => {
    void (async () => {
      try {
        const accResp = await fetch("/api/posterity/accounts", { cache: "no-store" });
        const accJson = await readApiJson<{ ok: boolean; accounts?: Array<{ id: string; name: string; nickname: string | null }> }>(
          accResp,
        );
        if (accJson.ok && accJson.accounts?.length) setPosterityAccounts(accJson.accounts);
      } catch {
        setPosterityAccounts([]);
      }
    })();
  }, []);

  useEffect(() => {
    void (async () => {
      setError(null);
      try {
        const [posResp, expResp] = await Promise.all([
          fetch(`/api/posterity/positions?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" }),
          fetch(`/api/posterity/exposure?accountId=${encodeURIComponent(accountId)}`, { cache: "no-store" }),
        ]);
        const posJson = await readApiJson<{ ok: boolean; positions?: PosterityPosition[]; error?: string }>(posResp);
        if (!posJson.ok) throw new Error(posJson.error ?? "Failed to load posterity positions");
        setPositions(posJson.positions ?? []);

        const expJson = await readApiJson<{ ok: boolean; exposure?: ExposureRow[]; error?: string }>(expResp);
        if (!expJson.ok) throw new Error(expJson.error ?? "Failed to load posterity exposure");
        setExposure(expJson.exposure ?? []);

        const syms = Array.from(new Set((expJson.exposure ?? []).map((r) => r.underlyingSymbol))).filter(Boolean);
        if (syms.length) {
          try {
            await fetch("/api/taxonomy/sync", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ symbols: syms }),
            });
            const txResp = await fetch(`/api/taxonomy?symbols=${encodeURIComponent(syms.join(","))}`, { cache: "no-store" });
            const txJson = await readApiJson<{ ok: boolean; taxonomy?: Record<string, TaxonomyRow> }>(txResp);
            const m = new Map<string, TaxonomyRow>();
            if (txJson.ok) {
              for (const [k, v] of Object.entries(txJson.taxonomy ?? {})) m.set(k.toUpperCase(), v);
            }
            setTax(m);
          } catch {
            // ignore taxonomy failures (pie still works without buckets)
            setTax(new Map());
          }
        } else {
          setTax(new Map());
        }
      } catch (e) {
        setError(e instanceof Error ? e.message : String(e));
      }
    })();
  }, [accountId]);

  const rolled = useMemo(() => rollupCategory(exposure, category, tax), [exposure, category, tax]);

  const capBySymbol = useMemo(() => {
    const m = new Map<string, number | null>();
    for (const [sym, row] of tax) m.set(sym, row.marketCap ?? null);
    return m;
  }, [tax]);

  useEffect(() => {
    if (category !== "marketCap") return;
    const syms = Array.from(new Set(exposure.map((r) => r.underlyingSymbol.trim().toUpperCase()).filter(Boolean)));
    if (syms.length === 0) return;
    let cancelled = false;
    void (async () => {
      try {
        await fetch("/api/taxonomy/sync", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ symbols: syms, refreshMarketCapsFromSchwab: true }),
        });
        const txResp = await fetch(`/api/taxonomy?symbols=${encodeURIComponent(syms.join(","))}`, { cache: "no-store" });
        const txJson = await readApiJson<{ ok: boolean; taxonomy?: Record<string, TaxonomyRow> }>(txResp);
        if (cancelled) return;
        setTax((prev) => {
          const next = new Map(prev);
          for (const [k, v] of Object.entries(txJson.taxonomy ?? {})) {
            next.set(k.toUpperCase(), v as TaxonomyRow);
          }
          return next;
        });
      } catch {
        /* ignore */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [category, exposure, accountId]);

  const posGroups = useMemo(() => {
    const m = new Map<string, PosterityPosition[]>();
    for (const p of positions) {
      const k = symKey(p);
      const arr = m.get(k) ?? [];
      arr.push(p);
      m.set(k, arr);
    }
    const keys = Array.from(m.keys()).sort((a, b) => a.localeCompare(b));
    return keys.map((k) => ({ underlying: k, rows: m.get(k) ?? [] }));
  }, [positions]);

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Posterity</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Archived Schwab accounts kept separate from the main dashboards.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/connections"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Connections
          </Link>
        </div>
      </div>

      <DraggableTileLayout
        storageKey="fh.posterity.tiles.v1"
        defaultOrder={["account", "diversification", "positions"]}
        tiles={{
          account: {
            title: "Account",
            children: (
              <>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between sm:gap-6">
          <div className="min-w-0 flex-1">
            <p className="text-sm text-zinc-600 dark:text-zinc-400">Choose which posterity account to view.</p>
          </div>
          <div
            className="flex w-full shrink-0 flex-col rounded-2xl border border-zinc-200/90 bg-zinc-100/90 p-1 shadow-inner sm:w-auto sm:min-w-[min(100%,22rem)] dark:border-white/10 dark:bg-zinc-900/70"
            role="tablist"
            aria-label="Posterity accounts"
          >
            <div className="flex w-full flex-col gap-1 sm:flex-row sm:gap-1">
              {POSTERITY_ACCOUNT_IDS.map((id) => {
                const meta = posterityAccounts.find((a) => a.id === id);
                const { primary, secondary } = posterityAccountButtonLabel(id, meta);
                const selected = accountId === id;
                return (
                  <button
                    key={id}
                    type="button"
                    role="tab"
                    aria-selected={selected}
                    onClick={() => setAccountId(id)}
                    className={
                      "flex min-h-[3.25rem] w-full flex-col items-center justify-center gap-0.5 rounded-xl px-3 py-2 text-center transition-colors duration-150 sm:min-w-[10.5rem] sm:flex-1 " +
                      (selected
                        ? "bg-white text-zinc-900 shadow-md ring-1 ring-zinc-900/10 dark:bg-zinc-800 dark:text-zinc-50 dark:ring-white/15"
                        : "text-zinc-600 hover:bg-white/60 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-white/5 dark:hover:text-zinc-100")
                    }
                    title={meta?.name ? `${meta.name}${meta.nickname ? ` · ${meta.nickname}` : ""} (${id})` : id}
                  >
                    <span className="max-w-[14rem] truncate text-sm font-semibold leading-snug">{primary}</span>
                    <span
                      className={
                        "max-w-[14rem] truncate font-mono text-[11px] tabular-nums leading-none tracking-wide " +
                        (selected ? "text-zinc-500 dark:text-zinc-400" : "text-zinc-400 dark:text-zinc-500")
                      }
                    >
                      {secondary}
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl border border-rose-300 bg-rose-50 p-4 text-sm text-rose-900 dark:border-rose-500/30 dark:bg-rose-500/10 dark:text-rose-200">
            {error}
          </div>
        ) : null}
              </>
            ),
          },
          diversification: {
            title: "Diversification (Posterity)",
            children: (
              <>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Same views as Diversification, scoped to this account.</p>

        <div className="mt-4 grid gap-4 lg:grid-cols-[18rem_1fr]">
          <div className="rounded-xl border border-zinc-300 bg-white p-4 dark:border-white/20 dark:bg-zinc-950">
            <div className="text-sm font-semibold">Category</div>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {(
                [
                  { key: "sector", label: "Sector" },
                  { key: "marketCap", label: "Market cap" },
                  { key: "revenueGeo", label: "Revenue geo" },
                ] as const
              ).map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setCategory(c.key)}
                  className={
                    BTN_CLASSES +
                    " shadow-sm " +
                    (category === c.key
                      ? "bg-zinc-900 text-white shadow dark:bg-white dark:text-zinc-900"
                      : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900")
                  }
                >
                  {c.label}
                </button>
              ))}
            </div>

            <div className="mt-4 rounded-lg border border-zinc-300 bg-zinc-50 p-3 text-sm dark:border-white/20 dark:bg-zinc-900/40">
              <div className="flex items-center justify-between gap-3">
                <div className="text-zinc-600 dark:text-zinc-400">Total</div>
                <div className="font-semibold">{usd2Masked(rolled.total, privacy.masked)}</div>
              </div>
            </div>
          </div>

          <div className="min-w-0">
            {category === "marketCap" ? (
              <ExposurePositionTreemap
                leaves={rolled.rows.flatMap((r) => r.constituents)}
                underlyingMarketCapBySymbol={capBySymbol}
                masked={privacy.masked}
                title="Market cap · Spot"
              />
            ) : (
              <FinancePiePanel
                title={`${category === "sector" ? "Sector" : "Revenue geo"} · Spot`}
                buckets={[
                  {
                    label: "tax",
                    totalMarketValue: rolled.total,
                    byAsset: rolled.rows.map((r) => ({
                      key: r.key,
                      marketValue: r.mv,
                      weight: rolled.total ? r.mv / rolled.total : 0,
                      constituents: r.constituents,
                    })),
                  },
                ]}
              />
            )}

          </div>
        </div>
              </>
            ),
          },
          positions: {
            title: "Positions (Posterity)",
            children: (
              <>
        <p className="text-sm text-zinc-600 dark:text-zinc-400">Latest snapshot for the selected posterity account.</p>

        <div className="mt-4 overflow-x-auto rounded-xl ring-1 ring-zinc-300 dark:ring-white/20">
          <table className="w-full min-w-[36rem] border-collapse text-sm">
            <thead className="bg-zinc-50 text-left dark:bg-zinc-900/40">
              <tr>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Underlying</th>
                <th className="whitespace-nowrap px-3 py-2 font-semibold">Instrument</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Qty</th>
                <th className="whitespace-nowrap px-3 py-2 text-right font-semibold">Market&nbsp;value</th>
              </tr>
            </thead>
            <tbody>
              {posGroups.map((g) => {
                const netMv = g.rows.reduce((s, r) => s + (r.marketValue ?? 0), 0);
                return (
                  <Fragment key={g.underlying}>
                    <tr
                      key={`${g.underlying}__header`}
                      className="border-t border-zinc-200 bg-zinc-50/60 dark:border-white/10 dark:bg-white/5"
                    >
                      <td className="whitespace-nowrap px-3 py-2 font-semibold">
                        <SymbolLink symbol={g.underlying}>{g.underlying}</SymbolLink>
                      </td>
                      <td className="px-3 py-2 text-xs text-zinc-600 dark:text-zinc-400" colSpan={2}>
                        {g.rows.length} positions
                      </td>
                      <td className="whitespace-nowrap px-3 py-2 text-right font-semibold tabular-nums">
                        {usd2Masked(netMv, privacy.masked)}
                      </td>
                    </tr>
                    {g.rows.map((p) => (
                      <tr key={p.positionId} className="border-t border-zinc-200 dark:border-white/10">
                        <td className="whitespace-nowrap px-3 py-2 text-zinc-600 dark:text-zinc-400">
                          <SymbolLink symbol={g.underlying}>{g.underlying}</SymbolLink>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 font-medium">
                          <SymbolLink symbol={symbolPageTargetFromInstrument(p)}>
                            {p.securityType === "option" ? formatOptLabel(p) : (p.symbol ?? "").toString().toUpperCase()}
                          </SymbolLink>
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {formatInt(p.quantity ?? 0)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-2 text-right tabular-nums">
                          {usd2Masked(p.marketValue ?? 0, privacy.masked)}
                        </td>
                      </tr>
                    ))}
                  </Fragment>
                );
              })}
              {posGroups.length === 0 ? (
                <tr className="border-t border-zinc-200 dark:border-white/10">
                  <td className="px-3 py-3 text-sm text-zinc-600 dark:text-zinc-400" colSpan={4}>
                    No positions for this account.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
              </>
            ),
          },
        }}
      />
    </div>
  );
}

