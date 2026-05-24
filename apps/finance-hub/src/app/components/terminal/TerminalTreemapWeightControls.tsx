"use client";

import type { ReactNode } from "react";

import type { ExposurePieMetric, ExposureScope, SyntheticChartBasis } from "@/lib/analytics/exposureWeighting";
import { EXPOSURE_PIE_METRIC_LABEL } from "@/lib/analytics/exposureWeighting";

const BTN =
  "flex h-8 min-w-0 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-2.5 text-xs font-semibold tracking-tight";

function btnClass(active: boolean, panel: "default" | "dark") {
  if (panel === "dark") {
    return (
      BTN +
      " " +
      (active
        ? "bg-emerald-500/25 text-emerald-100 ring-1 ring-emerald-400/50"
        : "border border-zinc-600 text-zinc-300 hover:border-zinc-500 hover:text-zinc-100")
    );
  }
  return (
    BTN +
    " " +
    (active
      ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
      : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
  );
}

function ControlGroup({
  label,
  children,
  panel,
}: {
  label: string;
  children: ReactNode;
  panel: "default" | "dark";
}) {
  return (
    <div className="flex min-w-0 flex-col gap-1">
      <span
        className={
          panel === "dark"
            ? "text-[10px] font-semibold uppercase tracking-wide text-zinc-500"
            : "text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400"
        }
      >
        {label}
      </span>
      <div className="flex flex-wrap items-center gap-1">{children}</div>
    </div>
  );
}

export function TerminalTreemapWeightControls({
  scope,
  onScopeChange,
  pieMetric,
  onPieMetricChange,
  syntheticChartBasis,
  onSyntheticChartBasisChange,
  panel = "default",
}: {
  scope: ExposureScope;
  onScopeChange: (scope: ExposureScope) => void;
  pieMetric: ExposurePieMetric;
  onPieMetricChange: (metric: ExposurePieMetric) => void;
  syntheticChartBasis: SyntheticChartBasis;
  onSyntheticChartBasisChange: (basis: SyntheticChartBasis) => void;
  panel?: "default" | "dark";
}) {
  const showChartBasis = pieMetric === "net" || pieMetric === "synthetic";

  return (
    <div className="mt-3 flex flex-wrap items-end gap-x-4 gap-y-2 sm:gap-x-6">
      <ControlGroup label="Scope" panel={panel}>
        {(
          [
            { key: "net", label: "All" },
            { key: "brokerage", label: "Brokerage" },
            { key: "retirement", label: "Retirement" },
            { key: "529", label: "529" },
          ] as const
        ).map((v) => (
          <button key={v.key} type="button" onClick={() => onScopeChange(v.key)} className={btnClass(scope === v.key, panel)}>
            {v.label}
          </button>
        ))}
      </ControlGroup>

      <ControlGroup label="Weights" panel={panel}>
        {(["net", "spot", "synthetic"] as const).map((m) => (
          <button key={m} type="button" onClick={() => onPieMetricChange(m)} className={btnClass(pieMetric === m, panel)}>
            {EXPOSURE_PIE_METRIC_LABEL[m]}
          </button>
        ))}
      </ControlGroup>

      <ControlGroup label="Chart MV" panel={panel}>
        {showChartBasis ? (
          <>
            <button
              type="button"
              onClick={() => onSyntheticChartBasisChange("delta")}
              className={btnClass(syntheticChartBasis === "delta", panel)}
            >
              Δ proxy
            </button>
            <button
              type="button"
              onClick={() => onSyntheticChartBasisChange("mark")}
              className={btnClass(syntheticChartBasis === "mark", panel)}
            >
              Mark
            </button>
          </>
        ) : (
          <span className={"flex h-8 items-center text-xs " + (panel === "dark" ? "text-zinc-500" : "text-zinc-500 dark:text-zinc-500")}>
            Net / Synthetic only
          </span>
        )}
      </ControlGroup>
    </div>
  );
}
