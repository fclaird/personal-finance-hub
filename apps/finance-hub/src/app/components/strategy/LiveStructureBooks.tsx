"use client";

import { useEffect, useMemo, useState } from "react";

import type { OptionRiskSummary } from "@/lib/alerts/optionRisk";
import { formatUsd2 } from "@/lib/format";
import {
  groupLiveStructureBooks,
  liveBookLinkedToOpenSituation,
  type LiveStructureKind,
} from "@/lib/situations/liveStructures";
import type { SituationView } from "@/lib/situations/apiTypes";

export function LiveStructureBooks({
  kind,
  situations,
  privacyMasked,
}: {
  kind: "short-strangles" | "butterflies";
  situations: SituationView[];
  privacyMasked: boolean;
}) {
  const liveKind: LiveStructureKind = kind === "short-strangles" ? "short-strangle" : "butterfly";
  const noun = kind === "short-strangles" ? "strangles" : "butterflies";
  const [summary, setSummary] = useState<OptionRiskSummary | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const resp = await fetch("/api/option-risk", { cache: "no-store" });
        const json = (await resp.json()) as OptionRiskSummary & { ok?: boolean };
        if (!cancelled && json.ok) {
          setSummary({
            positions: json.positions ?? [],
            undefinedRiskCount: json.undefinedRiskCount ?? 0,
            nakedShortCount: json.nakedShortCount ?? 0,
            marginPressure: json.marginPressure ?? [],
          });
        }
      } catch {
        /* live books are best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const books = useMemo(
    () => groupLiveStructureBooks(summary?.positions ?? [], liveKind),
    [summary, liveKind],
  );

  if (!summary || books.length === 0) return null;

  return (
    <div className="flex flex-col gap-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">Live {noun}</h3>
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          Latest snapshot holdings — not TRADE fills. Analytics only.
        </p>
      </div>
      <div className="grid gap-2">
        {books.map((b) => {
          const linked = liveBookLinkedToOpenSituation(b, situations);
          return (
            <article
              key={b.key}
              className="rounded-xl border border-zinc-200 bg-white px-3 py-2.5 dark:border-white/15 dark:bg-zinc-950"
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <div>
                  <div className="font-medium text-zinc-900 dark:text-zinc-100">
                    {b.underlying} {b.kind.replace(/-/g, " ")}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {b.accountName}
                    {b.expiration ? ` · ${b.expiration}` : ""}
                    {b.dte != null ? ` · ${b.dte} DTE` : ""}
                    {linked ? " · linked in book below" : " · not yet linked as a situation"}
                  </div>
                </div>
                <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-400">Snapshot</span>
              </div>
              <ul className="mt-2 space-y-1 text-xs">
                {b.legs.map((leg) => (
                  <li key={leg.positionId} className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="font-mono text-zinc-700 dark:text-zinc-200">
                      {leg.quantity} {leg.right}
                      {leg.strike != null ? ` ${leg.strike}` : ""}
                    </span>
                    <span className="text-zinc-500">
                      {leg.flags.structure === "short-strangle" ? "strangle" : leg.flags.structure.replace(/-/g, " ")}
                      {leg.flags.maxLoss === "unbounded" ? " · unbounded" : ""}
                      {leg.delta != null ? ` · Δ ${leg.delta.toFixed(2)}` : ""}
                      {leg.intrinsic != null && leg.intrinsic > 0
                        ? ` · ITM ${formatUsd2(leg.intrinsic, { mask: privacyMasked })}`
                        : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </article>
          );
        })}
      </div>
    </div>
  );
}
