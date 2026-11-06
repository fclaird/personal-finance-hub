/**
 * Federal Reserve FOMC dates, statement day (second day of each meeting).
 * 2026: federalreserve.gov/monetarypolicy/fomccalendars.htm
 * 2027: tentative schedule announced 2025-09-05. Each date stays tentative until the prior meeting confirms it.
 */
export type FomcMeeting = {
  readonly start: string;
  readonly decision: string;
  readonly projections: boolean;
  readonly tentative: boolean;
};

export const FOMC_MEETINGS: readonly FomcMeeting[] = [
  { start: "2026-01-27", decision: "2026-01-28", projections: false, tentative: false },
  { start: "2026-03-17", decision: "2026-03-18", projections: true, tentative: false },
  { start: "2026-04-28", decision: "2026-04-29", projections: false, tentative: false },
  { start: "2026-06-16", decision: "2026-06-17", projections: true, tentative: false },
  { start: "2026-07-28", decision: "2026-07-29", projections: false, tentative: false },
  { start: "2026-09-15", decision: "2026-09-16", projections: true, tentative: false },
  { start: "2026-10-27", decision: "2026-10-28", projections: false, tentative: false },
  { start: "2026-12-08", decision: "2026-12-09", projections: true, tentative: false },
  { start: "2027-01-26", decision: "2027-01-27", projections: false, tentative: true },
  { start: "2027-03-16", decision: "2027-03-17", projections: true, tentative: true },
  { start: "2027-04-27", decision: "2027-04-28", projections: false, tentative: true },
  { start: "2027-06-08", decision: "2027-06-09", projections: true, tentative: true },
  { start: "2027-07-27", decision: "2027-07-28", projections: false, tentative: true },
  { start: "2027-09-14", decision: "2027-09-15", projections: true, tentative: true },
  { start: "2027-10-26", decision: "2027-10-27", projections: false, tentative: true },
  { start: "2027-12-07", decision: "2027-12-08", projections: true, tentative: true },
];

export const FOMC_SOURCE =
  "Federal Reserve FOMC calendar (federalreserve.gov/monetarypolicy/fomccalendars.htm). 2027 dates are the tentative schedule.";

export type FomcEvent = {
  id: string;
  kind: "fomc";
  date: string;
  symbol: null;
  label: string;
  source: string;
  projections: boolean;
  tentative: boolean;
};

export function fomcEventsBetween(from: string, to: string): FomcEvent[] {
  return FOMC_MEETINGS.filter((meeting) => meeting.decision >= from && meeting.decision <= to).map((meeting) => ({
    id: `fomc_${meeting.decision}`,
    kind: "fomc" as const,
    date: meeting.decision,
    symbol: null,
    label: meeting.projections ? "FOMC decision and projections" : "FOMC decision",
    source: FOMC_SOURCE,
    projections: meeting.projections,
    tentative: meeting.tentative,
  }));
}
