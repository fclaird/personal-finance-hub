import {
  addCalendarDays,
  addCalendarMonths,
  calendarDaysBetween,
  formatExpiryLabel,
  type IsoDate,
} from "@/lib/optionChain/chain";

/** Steps closer than this are the same neighborhood. A week apart still counts as two steps. */
export const STEP_GAP_DAYS = 4;

/** Minus sign in labels such as E−2wk, so it does not read as a hyphenated word. */
export const STEP_MINUS = "\u2212";

export type ForwardStepKind = "today" | "quarter" | "expiryMonths" | "expiryWeeks" | "expiry";

export type ForwardDateStep = {
  readonly kind: ForwardStepKind;
  readonly date: IsoDate;
  /** Months after today for a quarter step, or months before expiry for an expiry-month step. */
  readonly months: number;
  /** Weeks before expiry. Zero for every other kind. */
  readonly weeks: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

/** "Jun 4". Short steps use this beside the E− tag. */
export function formatMonthDay(date: IsoDate): string {
  const [, month, day] = date.split("-").map(Number) as [number, number, number];
  return `${MONTHS[month - 1]} ${day}`;
}

/**
 * Forward dates from today through expiry.
 * Three-month steps run until the final three months. That window is expiry minus
 * three, two, and one months, then two weeks, one week, and expiry.
 * A step before today is dropped. A step within a few days of one already kept is
 * dropped, unless the pair is Today and Expiry.
 */
export function forwardDateSteps(today: IsoDate, expiry: IsoDate): ForwardDateStep[] {
  if (calendarDaysBetween(today, expiry) <= 0) {
    return [{ kind: "expiry", date: expiry, months: 0, weeks: 0 }];
  }

  const fence = addCalendarMonths(expiry, -3);
  const quarterly: ForwardDateStep[] = [{ kind: "today", date: today, months: 0, weeks: 0 }];
  for (let step = 1; step < 40; step++) {
    const months = step * 3;
    const date = addCalendarMonths(today, months);
    if (calendarDaysBetween(date, expiry) <= 0) break;
    if (calendarDaysBetween(date, fence) <= 0) break;
    quarterly.push({ kind: "quarter", date, months, weeks: 0 });
  }

  const anchored: ForwardDateStep[] = [
    { kind: "expiryMonths", date: addCalendarMonths(expiry, -3), months: 3, weeks: 0 },
    { kind: "expiryMonths", date: addCalendarMonths(expiry, -2), months: 2, weeks: 0 },
    { kind: "expiryMonths", date: addCalendarMonths(expiry, -1), months: 1, weeks: 0 },
    { kind: "expiryWeeks", date: addCalendarDays(expiry, -14), months: 0, weeks: 2 },
    { kind: "expiryWeeks", date: addCalendarDays(expiry, -7), months: 0, weeks: 1 },
    { kind: "expiry", date: expiry, months: 0, weeks: 0 },
  ];

  const upcoming = [...quarterly, ...anchored].filter(
    (step) => step.kind === "expiry" || calendarDaysBetween(today, step.date) >= 0,
  );
  return dedupe(upcoming);
}

/** Years of option life left at this step. Expiry is zero. */
export function yearsUntilExpiry(step: ForwardDateStep, expiry: IsoDate): number {
  if (step.kind === "expiry") return 0;
  const days = calendarDaysBetween(step.date, expiry);
  return days > 0 ? days / 365 : 0;
}

export function forwardStepId(step: ForwardDateStep): string {
  if (step.kind === "today") return `d:today:${step.date}`;
  if (step.kind === "quarter") return `d:q:${step.months}:${step.date}`;
  if (step.kind === "expiryMonths") return `d:em:${step.months}:${step.date}`;
  if (step.kind === "expiryWeeks") return `d:ew:${step.weeks}:${step.date}`;
  return `d:expiry:${step.date}`;
}

/**
 * Visible name for a step.
 * Short steps always include the month and day (`E−2wk · Jun 4`).
 * Today, the three-month steps, and Expiry include that short date when several
 * expiries share the schedule; otherwise the long weekday form stays behind the tag.
 */
export function forwardStepLabel(step: ForwardDateStep, showDate: boolean): string {
  const long = formatExpiryLabel(step.date);
  const short = formatMonthDay(step.date);
  if (step.kind === "today") return showDate ? `Today · ${short}` : `Today · ${long}`;
  if (step.kind === "quarter") return showDate ? `+${step.months} mo · ${short}` : `+${step.months} mo · ${long}`;
  if (step.kind === "expiryMonths") return `E${STEP_MINUS}${step.months}mo · ${short}`;
  if (step.kind === "expiryWeeks") return `E${STEP_MINUS}${step.weeks}wk · ${short}`;
  return showDate ? `Expiry · ${short}` : `Expiry · ${long}`;
}

function rank(step: ForwardDateStep): number {
  if (step.kind === "expiry") return 50;
  if (step.kind === "today") return 40;
  if (step.kind === "expiryWeeks") return 30;
  if (step.kind === "expiryMonths") return 20;
  return 10;
}

function dedupe(steps: readonly ForwardDateStep[]): ForwardDateStep[] {
  const sorted = steps.slice().sort((a, b) => {
    if (a.date !== b.date) return a.date < b.date ? -1 : 1;
    return rank(b) - rank(a);
  });
  const kept: ForwardDateStep[] = [];
  for (const step of sorted) {
    const prev = kept[kept.length - 1];
    if (!prev) {
      kept.push(step);
      continue;
    }
    const gap = calendarDaysBetween(prev.date, step.date);
    if (gap >= STEP_GAP_DAYS) {
      kept.push(step);
      continue;
    }
    const endpoints =
      (prev.kind === "today" || prev.kind === "expiry") &&
      (step.kind === "today" || step.kind === "expiry") &&
      prev.kind !== step.kind;
    if (endpoints) {
      kept.push(step);
      continue;
    }
    if (rank(step) > rank(prev)) kept[kept.length - 1] = step;
  }
  return kept;
}
