"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { SymbolLink } from "@/app/components/SymbolLink";
import type { OptionRiskPosition, OptionRiskSummary } from "@/lib/alerts/optionRisk";

function flagBadges(p: OptionRiskPosition): string[] {
  const out: string[] = [];
  if (p.flags.maxLoss === "unbounded") out.push("UNBOUNDED");
  else if (p.flags.undefinedRisk) out.push("UNDEF");
  if (p.flags.structure === "naked-call") out.push("NAKED CALL");
  if (p.flags.structure === "naked-put") out.push("NAKED PUT");
  if (p.flags.structure === "short-strangle") out.push("STRANGLE");
  if (p.flags.deltaOffBand && p.flags.absDelta != null) out.push(`Δ ${p.flags.absDelta.toFixed(2)}`);
  if (p.flags.shortDte && p.dte != null) out.push(`${p.dte} DTE`);
  if (p.flags.itm) out.push("ITM");
  else if (p.flags.assignmentNear) out.push("NEAR STRIKE");
  return out;
}

export function OptionRiskPanel() {
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
        /* live panel is best-effort */
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const flagged = (summary?.positions ?? []).filter(
    (p) => p.flags.undefinedRisk || p.flags.nakedShort || p.flags.assignmentNear || p.flags.shortDte || p.flags.deltaOffBand,
  );
  const marginHits = (summary?.marginPressure ?? []).filter((m) => m.breached);

  return (
    <div className="mt-5">
      <div className="flex items-center justify-between gap-2">
        <div className="text-sm font-semibold">Options risk</div>
        <Link href="/alerts" className="text-[11px] font-medium text-zinc-600 underline-offset-4 hover:underline dark:text-zinc-400">
          Alerts
        </Link>
      </div>
      <div className="mt-1 text-[11px] text-zinc-600 dark:text-zinc-400">
        Naked shorts, ~15Δ band, DTE, assignment, margin. Undefined risk = unbounded short call / strangle.
      </div>
      <div className="mt-2 flex flex-wrap gap-2 text-[11px]">
        <span className="rounded-full bg-red-100 px-2 py-0.5 font-semibold text-red-900 dark:bg-red-950/50 dark:text-red-100">
          {summary?.undefinedRiskCount ?? 0} unbounded
        </span>
        <span className="rounded-full bg-amber-100 px-2 py-0.5 font-semibold text-amber-950 dark:bg-amber-950/40 dark:text-amber-100">
          {summary?.nakedShortCount ?? 0} naked
        </span>
        {marginHits.length ? (
          <span className="rounded-full bg-orange-100 px-2 py-0.5 font-semibold text-orange-950 dark:bg-orange-950/40 dark:text-orange-100">
            {marginHits.length} margin
          </span>
        ) : null}
      </div>
      <div className="mt-2 grid gap-1">
        {flagged.slice(0, 8).map((p) => (
          <SymbolLink
            key={p.positionId}
            symbol={p.underlying}
            title={p.symbol}
            className="relative flex w-full items-center justify-between overflow-hidden rounded-md border border-zinc-300 bg-white/70 px-2 py-1 text-xs hover:no-underline dark:border-white/15 dark:bg-zinc-950/40"
          >
            <span className="font-semibold">{p.underlying}</span>
            <span className="flex flex-wrap justify-end gap-1">
              {flagBadges(p).map((b) => (
                <span
                  key={b}
                  className={
                    "rounded px-1 py-0.5 text-[10px] font-semibold " +
                    (b === "UNBOUNDED"
                      ? "bg-red-200 text-red-950 dark:bg-red-900/70 dark:text-red-50"
                      : "bg-zinc-200 text-zinc-800 dark:bg-zinc-800 dark:text-zinc-100")
                  }
                >
                  {b}
                </span>
              ))}
            </span>
          </SymbolLink>
        ))}
        {summary && flagged.length === 0 ? (
          <div className="text-[11px] text-zinc-500 dark:text-zinc-400">No short-option risk flags in the latest snapshots.</div>
        ) : null}
      </div>
    </div>
  );
}
