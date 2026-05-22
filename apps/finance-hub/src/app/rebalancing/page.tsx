"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { usePrivacy } from "@/app/components/PrivacyProvider";
import { formatUsd2 } from "@/lib/format";

type Target = { assetClass: string; targetWeight: number };

type DriftRow = {
  assetClass: string;
  currentWeight: number;
  targetWeight: number;
  drift: number;
  currentMarketValue: number;
  targetMarketValue: number;
  suggestedDeltaMarketValue: number;
};

function usd2Masked(v: number, masked: boolean) {
  return formatUsd2(v, { mask: masked });
}

export default function RebalancingPage() {
  const privacy = usePrivacy();
  const [includeSynthetic, setIncludeSynthetic] = useState(true);
  const [targets, setTargets] = useState<Target[]>([]);
  const [drift, setDrift] = useState<DriftRow[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    (async () => {
      setError(null);
      const [tResp, rResp] = await Promise.all([
        fetch("/api/targets"),
        fetch(`/api/rebalancing?synthetic=${includeSynthetic ? "1" : "0"}`),
      ]);

      const tJson = (await tResp.json()) as { ok: boolean; targets?: Target[]; error?: string };
      if (!tJson.ok) throw new Error(tJson.error ?? "Failed to load targets");
      setTargets(tJson.targets ?? []);

      const rJson = (await rResp.json()) as { ok: boolean; drift?: DriftRow[]; error?: string };
      if (!rJson.ok) throw new Error(rJson.error ?? "Failed to load rebalancing");
      setDrift(rJson.drift ?? []);
    })().catch((e) => setError(e instanceof Error ? e.message : String(e)));
  }, [includeSynthetic]);

  const targetSum = useMemo(() => targets.reduce((s, t) => s + t.targetWeight, 0), [targets]);

  function updateTarget(assetClass: string, w: number) {
    setTargets((prev) => {
      const next = [...prev];
      const idx = next.findIndex((t) => t.assetClass === assetClass);
      if (idx >= 0) next[idx] = { assetClass, targetWeight: w };
      else next.push({ assetClass, targetWeight: w });
      return next;
    });
  }

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch("/api/targets", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ targets }),
      });
      const json = (await resp.json()) as { ok: boolean; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to save");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="flex w-full max-w-[108rem] flex-1 flex-col gap-8 py-10 pl-5 pr-6 sm:pl-6 sm:pr-8">
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Rebalancing</h1>
          <p className="mt-2 text-sm leading-6 text-zinc-600 dark:text-zinc-400">
            Set asset class targets and see drift + advisory dollar deltas.
          </p>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href="/alerts"
            className="rounded-full border border-zinc-300 bg-white px-4 py-2 text-sm font-medium text-zinc-900 shadow-sm hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Alerts
          </Link>
        </div>
      </div>

      <section className="rounded-2xl border border-zinc-300 bg-white p-6 shadow-sm dark:border-white/20 dark:bg-zinc-950">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <label className="flex items-center gap-3 text-sm font-medium">
            <input
              type="checkbox"
              checked={includeSynthetic}
              onChange={(e) => setIncludeSynthetic(e.target.checked)}
              className="h-4 w-4 accent-zinc-900 dark:accent-white"
            />
            Include synthetic (Delta) exposure
          </label>
          <button
            type="button"
            onClick={save}
            disabled={saving}
            className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {saving ? "Saving…" : "Save targets"}
          </button>
        </div>

        <div className="mt-4 text-sm text-zinc-600 dark:text-zinc-400">
          Target sum: <span className="font-semibold">{(targetSum * 100).toFixed(2)}%</span>
        </div>

        {error ? (
          <div className="mt-4 rounded-xl bg-red-50 p-3 text-sm text-red-900 dark:bg-red-950/30 dark:text-red-200">
            {error}
          </div>
        ) : null}

        <div className="mt-5 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-zinc-300 text-left text-zinc-600 dark:border-white/20 dark:text-zinc-400">
                <th className="py-2 pr-4 font-medium">Asset class</th>
                <th className="py-2 pr-4 text-right font-medium">Target %</th>
                <th className="py-2 pr-4 text-right font-medium">Current %</th>
                <th className="py-2 pr-4 text-right font-medium">Drift</th>
                <th className="py-2 pr-4 text-right font-medium">Suggested $ delta</th>
              </tr>
            </thead>
            <tbody>
              {drift.map((d) => (
                <tr key={d.assetClass} className="border-b border-zinc-200 dark:border-white/20">
                  <td className="py-2 pr-4 font-medium">{d.assetClass}</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    <input
                      className="w-24 rounded-md border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-white/20 dark:bg-zinc-950"
                      value={((targets.find((t) => t.assetClass === d.assetClass)?.targetWeight ?? 0) * 100).toFixed(2)}
                      onChange={(e) => updateTarget(d.assetClass, Math.max(0, Number(e.target.value) / 100))}
                    />
                  </td>
                  <td className="py-2 pr-4 text-right tabular-nums">{(d.currentWeight * 100).toFixed(2)}%</td>
                  <td className="py-2 pr-4 text-right tabular-nums">{(d.drift * 100).toFixed(2)}%</td>
                  <td className="py-2 pr-4 text-right tabular-nums">
                    {d.suggestedDeltaMarketValue >= 0 ? "+" : "-"}
                    {usd2Masked(Math.abs(d.suggestedDeltaMarketValue), privacy.masked)}
                  </td>
                </tr>
              ))}
              {drift.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-6 text-center text-zinc-600 dark:text-zinc-400">
                    No data yet. Run a sync first.
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}

