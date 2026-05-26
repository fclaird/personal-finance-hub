import type { GlanceChartContext, TimedClosePoint } from "@/lib/market/glanceExtendedHours";
import { isoDateInUsEastern } from "@/lib/market/glanceSession";

/** Timed bars for quick-glance session split (prior RTH day + today's pre when applicable). */
export function filterTimedPointsForGlanceSession(
  points: TimedClosePoint[],
  sessionYmd: string,
  ctx: GlanceChartContext,
): TimedClosePoint[] {
  if (ctx.extendedPhase === "pre" && ctx.chartYmd !== sessionYmd) {
    return points.filter((p) => {
      const ymd = isoDateInUsEastern(p.tsMs);
      return ymd === sessionYmd || ymd === ctx.chartYmd;
    });
  }
  return points.filter((p) => isoDateInUsEastern(p.tsMs) === sessionYmd);
}

export function filterExtendedRawForGrid(
  extended: TimedClosePoint[],
  regular: TimedClosePoint[],
  extendedPhase: "pre" | "post" | null,
): TimedClosePoint[] {
  const valid = extended.filter((p) => p.tsMs > 0);
  if (valid.length === 0) return [];
  if (regular.length === 0) return valid;
  const rthCloseTs = regular[regular.length - 1]!.tsMs;
  if (extendedPhase === "pre") {
    return valid.filter((p) => p.tsMs > rthCloseTs);
  }
  return valid.filter((p) => p.tsMs > rthCloseTs);
}
