import type { ExposurePieMetric, ExposureScope, SyntheticChartBasis } from "@/lib/analytics/exposureWeighting";

export function readTreemapScope(): ExposureScope {
  try {
    const v = localStorage.getItem("terminal_treemap_scope_v1");
    if (v === "net" || v === "brokerage" || v === "retirement" || v === "529") return v;
  } catch {
    // ignore
  }
  return "net";
}

export function readTreemapMetric(): ExposurePieMetric {
  try {
    const v = localStorage.getItem("terminal_treemap_metric_v1");
    if (v === "net" || v === "spot" || v === "synthetic") return v;
  } catch {
    // ignore
  }
  return "net";
}

export function readTreemapSyntheticBasis(): SyntheticChartBasis {
  try {
    const v = localStorage.getItem("terminal_treemap_synthetic_basis_v1");
    if (v === "delta" || v === "mark") return v;
  } catch {
    // ignore
  }
  return "delta";
}
