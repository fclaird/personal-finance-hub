export type ChartInterval = "1d" | "1wk" | "1mo" | "5m" | "15m" | "60m";

export type ChartTime = string | number;

export type ChartCandle = {
  time: ChartTime;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ExtendedQuote = {
  price: number;
  change: number | null;
  changePercent: number | null;
};

export type ChartQuoteMeta = {
  name: string | null;
  exchange: string | null;
  currency: string | null;
  marketState: string | null;
  previousClose: number | null;
  postMarket: ExtendedQuote | null;
  preMarket: ExtendedQuote | null;
  timezone: string | null;
};

export const CHART_INTERVALS: ChartInterval[] = ["1d", "1wk", "1mo", "5m", "15m", "60m"];

export function isChartInterval(value: string): value is ChartInterval {
  return (CHART_INTERVALS as string[]).includes(value);
}
