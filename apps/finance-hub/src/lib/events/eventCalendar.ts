import type { ExpectedMove } from "@/lib/events/expectedMove";
import { fomcEventsBetween, type FomcEvent } from "@/lib/events/fomcCalendar";

export type EventKind = "earnings" | "ex-dividend" | "fomc";

export type CalendarEvent = {
  id: string;
  kind: EventKind;
  date: string;
  symbol: string | null;
  label: string;
  source: string;
};

export type OpenOption = {
  positionId: string;
  underlying: string;
  expiry: string;
  label: string;
};

export type FlaggedOption = {
  positionId: string;
  underlying: string;
  expiry: string;
  label: string;
  events: CalendarEvent[];
};

export type EarningsInput = {
  symbol: string;
  date: string;
  timeOfDay: string | null;
  source: string;
};

export type ExDividendInput = {
  symbol: string;
  date: string;
  source: string;
};

const KIND_ORDER: Record<EventKind, number> = { earnings: 0, "ex-dividend": 1, fomc: 2 };

function symbolKey(symbol: string): string {
  return symbol.trim().toUpperCase();
}

function earningsLabel(row: EarningsInput): string {
  const when = row.timeOfDay === "bmo" ? "before the open" : row.timeOfDay === "amc" ? "after the close" : null;
  return when ? `Earnings ${when}` : "Earnings";
}

/** One calendar row per symbol and date. Later rows do not replace an earlier source. */
export function calendarEvents(input: {
  earnings: readonly EarningsInput[];
  exDividends: readonly ExDividendInput[];
  fomc: readonly FomcEvent[];
}): CalendarEvent[] {
  const events: CalendarEvent[] = [];
  const seen = new Set<string>();
  for (const row of input.earnings) {
    const symbol = symbolKey(row.symbol);
    if (!symbol || !row.date) continue;
    const id = `earn_${symbol}_${row.date}`;
    if (seen.has(id)) continue;
    seen.add(id);
    events.push({ id, kind: "earnings", date: row.date, symbol, label: earningsLabel(row), source: row.source });
  }
  for (const row of input.exDividends) {
    const symbol = symbolKey(row.symbol);
    if (!symbol || !row.date) continue;
    const id = `exdiv_${symbol}_${row.date}`;
    if (seen.has(id)) continue;
    seen.add(id);
    events.push({ id, kind: "ex-dividend", date: row.date, symbol, label: "Ex-dividend", source: row.source });
  }
  for (const row of input.fomc) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    events.push({ id: row.id, kind: "fomc", date: row.date, symbol: null, label: row.label, source: row.source });
  }
  return events.sort(
    (a, b) => a.date.localeCompare(b.date) || KIND_ORDER[a.kind] - KIND_ORDER[b.kind] || (a.symbol ?? "").localeCompare(b.symbol ?? ""),
  );
}

/**
 * An open option is flagged when an event lands on or before its expiry and on or after today.
 * Earnings and ex-dividend match the underlying. FOMC applies to every option.
 */
export function flagOptionsWithEvents(
  events: readonly CalendarEvent[],
  options: readonly OpenOption[],
  today: string,
): FlaggedOption[] {
  const flagged: FlaggedOption[] = [];
  for (const option of options) {
    const underlying = symbolKey(option.underlying);
    if (!option.expiry || option.expiry < today) continue;
    const hits = events.filter((event) => {
      if (event.date < today || event.date > option.expiry) return false;
      if (event.kind === "fomc") return true;
      return event.symbol != null && symbolKey(event.symbol) === underlying;
    });
    if (hits.length === 0) continue;
    flagged.push({
      positionId: option.positionId,
      underlying,
      expiry: option.expiry,
      label: option.label,
      events: hits,
    });
  }
  return flagged.sort((a, b) => a.expiry.localeCompare(b.expiry) || a.underlying.localeCompare(b.underlying));
}

export type EventCalendarView = {
  today: string;
  through: string;
  symbols: string[];
  events: CalendarEvent[];
  flagged: FlaggedOption[];
  moves: ExpectedMove[];
};

export function buildEventCalendar(input: {
  today: string;
  through: string;
  symbols: readonly string[];
  earnings: readonly EarningsInput[];
  exDividends: readonly ExDividendInput[];
  options: readonly OpenOption[];
  moves: readonly ExpectedMove[];
}): EventCalendarView {
  const symbols = [...new Set(input.symbols.map(symbolKey).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  const symbolSet = new Set(symbols);
  const earnings = input.earnings.filter((row) => symbolSet.has(symbolKey(row.symbol)) && row.date >= input.today && row.date <= input.through);
  const exDividends = input.exDividends.filter(
    (row) => symbolSet.has(symbolKey(row.symbol)) && row.date >= input.today && row.date <= input.through,
  );
  const events = calendarEvents({
    earnings,
    exDividends,
    fomc: fomcEventsBetween(input.today, input.through),
  });
  return {
    today: input.today,
    through: input.through,
    symbols,
    events,
    flagged: flagOptionsWithEvents(events, input.options, input.today),
    moves: [...input.moves],
  };
}
