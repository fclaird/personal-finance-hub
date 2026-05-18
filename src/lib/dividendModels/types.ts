export type TimelineYears = 1 | 3 | 5;
export type SimulationMode = "reinvest" | "withdraw";

export function parseTimelineYears(raw: string | null | undefined): TimelineYears {
  if (raw === "1") return 1;
  if (raw === "3") return 3;
  return 5;
}

export function parseSimulationMode(raw: string | null | undefined): SimulationMode {
  return raw === "reinvest" ? "reinvest" : "withdraw";
}
