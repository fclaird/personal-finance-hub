import type { ScreenerFilters } from "@/lib/screener/types";
import { EMPTY_FILTERS } from "@/lib/screener/filter";

export const BUILTIN_PRESETS: Array<{ id: string; name: string; filters: ScreenerFilters }> = [
  {
    id: "low-war-peg",
    name: "Low war exposure + PEG<1.5",
    filters: {
      ...EMPTY_FILTERS,
      warExposure: ["Low"],
      pegMax: 1.5,
      pegMaxInclusive: false,
      requireCited: true,
    },
  },
  {
    id: "low-qqq-top100",
    name: "Low QQQ correlation, top-100 size",
    filters: {
      ...EMPTY_FILTERS,
      corrTarget: "qqq",
      corrWindow: "1y",
      corrBand: "L",
      sizeRankMax: 100,
      requireCited: true,
    },
  },
];

export function presetFilters(input: Partial<ScreenerFilters> | null | undefined): ScreenerFilters {
  return { ...EMPTY_FILTERS, ...(input ?? {}) };
}
