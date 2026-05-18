import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";

export type SchwabNormalizedQuote = {
  symbol: string;
  last: number | null;
  bid: number | null;
  ask: number | null;
  mark: number | null;
  close: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  volume: number | null;
  change: number | null;
  changePercent: number | null;
  week52High: number | null;
  week52Low: number | null;
  updatedAt: string;
};

function asNumber(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string" && v.trim() !== "" && Number.isFinite(Number(v))) return Number(v);
  return null;
}

function pickPositive(...vals: Array<number | null | undefined>): number | null {
  for (const v of vals) {
    if (v != null && Number.isFinite(v) && v > 0) return v;
  }
  return null;
}

export function parseSchwabNormalizedQuote(
  sym: string,
  q: Record<string, unknown> | null,
  updatedAt: string,
): SchwabNormalizedQuote {
  if (!q) {
    return {
      symbol: sym,
      last: null,
      bid: null,
      ask: null,
      mark: null,
      close: null,
      open: null,
      high: null,
      low: null,
      volume: null,
      change: null,
      changePercent: null,
      week52High: null,
      week52Low: null,
      updatedAt,
    };
  }

  const rawLast = asNumber(q.lastPrice) ?? null;
  const bid = asNumber(q.bidPrice ?? q.bid) ?? null;
  const ask = asNumber(q.askPrice ?? q.ask) ?? null;
  const mark = asNumber(q.mark) ?? null;
  const close = asNumber(q.closePrice) ?? null;
  const last = schwabQuoteDisplayPrice(rawLast, mark, close);
  const change = asNumber(q.netChange ?? q.change) ?? (last != null && close != null ? last - close : null);
  const changePercent =
    asNumber(q.netPercentChangeInDouble ?? q.changePercent) ??
    (change != null && close != null && close !== 0 ? change / close : null);

  return {
    symbol: sym,
    last,
    bid,
    ask,
    mark,
    close,
    open: pickPositive(asNumber(q.openPrice)),
    high: pickPositive(asNumber(q.highPrice), asNumber(q.high)),
    low: pickPositive(asNumber(q.lowPrice), asNumber(q.low)),
    volume: pickPositive(asNumber(q.totalVolume), asNumber(q.volume)),
    change,
    changePercent: changePercent == null ? null : changePercent,
    week52High: pickPositive(
      asNumber(q["52WeekHigh"]),
      asNumber(q.fiftyTwoWeekHigh),
      asNumber(q.week52High),
    ),
    week52Low: pickPositive(
      asNumber(q["52WeekLow"]),
      asNumber(q.fiftyTwoWeekLow),
      asNumber(q.week52Low),
    ),
    updatedAt,
  };
}
