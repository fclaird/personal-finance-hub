import { futureTimes, isIntradayInterval, regularSessionKey } from "@/lib/charts/bars";
import { bollinger, bullMarketSupportBand, ichimoku, sessionVwap, sma, type Num } from "@/lib/charts/indicators";
import type { IndicatorSettings } from "@/lib/charts/indicatorSettings";
import { CANDLE_DOWN, CANDLE_UP } from "@/lib/charts/palette";
import type { ChartCandle, ChartInterval, ChartTime } from "@/lib/charts/types";

export type LinePoint = { time: ChartTime; value: number };

export type CloudPoint = { index: number; time: ChartTime; a: number; b: number };

export type BandPoint = { index: number; time: ChartTime; upper: number; lower: number };

export type LegendValues = {
  bar: ChartCandle | null;
  change: number | null;
  changePct: number | null;
  mas: Num[];
  conversion: Num;
  base: Num;
  spanA: Num;
  spanB: Num;
  lagging: Num;
  leadingA: Num;
  leadingB: Num;
  bbMid: Num;
  bbUp: Num;
  bbLo: Num;
  bmsbSma: Num;
  bmsbEma: Num;
  vwap: Num;
};

export type ChartModel = {
  times: ChartTime[];
  candles: ChartCandle[];
  candleData: Array<{ time: ChartTime; open?: number; high?: number; low?: number; close?: number }>;
  volume: Array<{ time: ChartTime; value: number; color: string }>;
  mas: LinePoint[][];
  conversion: LinePoint[];
  base: LinePoint[];
  spanA: LinePoint[];
  spanB: LinePoint[];
  lagging: LinePoint[];
  cloud: CloudPoint[];
  bbMid: LinePoint[];
  bbUp: LinePoint[];
  bbLo: LinePoint[];
  bbFill: BandPoint[];
  bmsbSma: LinePoint[];
  bmsbEma: LinePoint[];
  bmsbFill: BandPoint[];
  vwap: LinePoint[];
  valuesAt: (index: number | null) => LegendValues;
};

function at(values: readonly Num[], index: number): Num {
  if (index < 0 || index >= values.length) return null;
  return values[index] ?? null;
}

function pointsFrom(values: readonly Num[], times: readonly ChartTime[]): LinePoint[] {
  const out: LinePoint[] = [];
  const n = Math.min(values.length, times.length);
  for (let i = 0; i < n; i++) {
    const value = values[i];
    if (value == null || !Number.isFinite(value)) continue;
    out.push({ time: times[i]!, value });
  }
  return out;
}

function extendFuture(last: ChartTime, interval: ChartInterval, displacement: number, until: string | null): ChartTime[] {
  const future: ChartTime[] = displacement > 0 ? futureTimes(last, interval, displacement) : [];
  if (!until || isIntradayInterval(interval)) return future;
  let guard = 0;
  while ((future.length === 0 || String(future[future.length - 1]) < until) && guard < 400) {
    const cursor = future.length ? future[future.length - 1]! : last;
    const next = futureTimes(cursor, interval, 1)[0];
    if (next == null || String(next) === String(cursor)) break;
    future.push(next);
    guard += 1;
  }
  return future;
}

export function buildChartModel(
  candles: readonly ChartCandle[],
  interval: ChartInterval,
  settings: IndicatorSettings,
  expiryUntil: string | null = null,
): ChartModel {
  const displacement = settings.ichimoku.displacement;
  const last = candles.length ? candles[candles.length - 1]!.time : null;
  const future = last == null ? [] : extendFuture(last, interval, displacement, settings.book.visible ? expiryUntil : null);
  const times: ChartTime[] = candles.map((bar) => bar.time).concat(future);
  const closes = candles.map((bar) => bar.close);
  const maValues = settings.ma.map((ma) => sma(closes, ma.period));
  const ichi = ichimoku(
    candles,
    settings.ichimoku.conversion,
    settings.ichimoku.base,
    settings.ichimoku.span,
    displacement,
  );
  const bands = bollinger(closes, settings.bb.period, settings.bb.mult);
  const weeklyOk = candles.every((bar) => typeof bar.time === "string");
  const bmsb = weeklyOk
    ? bullMarketSupportBand(
        candles.map((bar) => ({ time: String(bar.time), close: bar.close })),
        settings.bmsb.smaPeriod,
        settings.bmsb.emaPeriod,
      )
    : { sma: candles.map(() => null), ema: candles.map(() => null) };
  const vwapValues = isIntradayInterval(interval)
    ? sessionVwap(
        candles.map((bar) => ({
          high: bar.high,
          low: bar.low,
          close: bar.close,
          volume: bar.volume,
          session: typeof bar.time === "number" ? regularSessionKey(bar.time) : null,
        })),
      )
    : candles.map(() => null);

  const cloud: CloudPoint[] = [];
  for (let i = 0; i < times.length; i++) {
    const a = ichi.spanA[i];
    const b = ichi.spanB[i];
    if (a == null || b == null || !Number.isFinite(a) || !Number.isFinite(b)) continue;
    cloud.push({ index: i, time: times[i]!, a, b });
  }
  const bbFill: BandPoint[] = [];
  const bmsbFill: BandPoint[] = [];
  for (let i = 0; i < candles.length; i++) {
    const up = bands.upper[i];
    const lo = bands.lower[i];
    if (up != null && lo != null) bbFill.push({ index: i, time: times[i]!, upper: up, lower: lo });
    const hi = bmsb.sma[i];
    const loE = bmsb.ema[i];
    if (hi != null && loE != null) bmsbFill.push({ index: i, time: times[i]!, upper: Math.max(hi, loE), lower: Math.min(hi, loE) });
  }

  const up = settings.volume.up || CANDLE_UP;
  const down = settings.volume.down || CANDLE_DOWN;

  function valuesAt(index: number | null): LegendValues {
    const i = index == null ? candles.length - 1 : index;
    const bar = i >= 0 && i < candles.length ? candles[i]! : null;
    const prev = i > 0 && i < candles.length ? candles[i - 1]! : null;
    const change = bar && prev ? bar.close - prev.close : null;
    const changePct = change != null && prev && prev.close !== 0 ? (change / prev.close) * 100 : null;
    return {
      bar,
      change,
      changePct,
      mas: maValues.map((series) => at(series, i)),
      conversion: at(ichi.conversion, i),
      base: at(ichi.base, i),
      spanA: at(ichi.spanA, i),
      spanB: at(ichi.spanB, i),
      lagging: at(ichi.lagging, i),
      leadingA: at(ichi.spanARaw, i),
      leadingB: at(ichi.spanBRaw, i),
      bbMid: at(bands.middle, i),
      bbUp: at(bands.upper, i),
      bbLo: at(bands.lower, i),
      bmsbSma: at(bmsb.sma, i),
      bmsbEma: at(bmsb.ema, i),
      vwap: at(vwapValues, i),
    };
  }

  return {
    times,
    candles: [...candles],
    candleData: times.map((time, i) => {
      const bar = candles[i];
      if (!bar) return { time };
      return { time, open: bar.open, high: bar.high, low: bar.low, close: bar.close };
    }),
    volume: candles.map((bar) => ({
      time: bar.time,
      value: bar.volume,
      color: bar.close >= bar.open ? up : down,
    })),
    mas: maValues.map((series) => pointsFrom(series, times)),
    conversion: pointsFrom(ichi.conversion, times),
    base: pointsFrom(ichi.base, times),
    spanA: pointsFrom(ichi.spanA, times),
    spanB: pointsFrom(ichi.spanB, times),
    lagging: pointsFrom(ichi.lagging, times),
    cloud,
    bbMid: pointsFrom(bands.middle, times),
    bbUp: pointsFrom(bands.upper, times),
    bbLo: pointsFrom(bands.lower, times),
    bbFill,
    bmsbSma: pointsFrom(bmsb.sma, times),
    bmsbEma: pointsFrom(bmsb.ema, times),
    bmsbFill,
    vwap: pointsFrom(vwapValues, times),
    valuesAt,
  };
}

export function snapExpiryTime(times: readonly ChartTime[], expiry: string): ChartTime | null {
  let best: string | null = null;
  for (const time of times) {
    if (typeof time !== "string") return null;
    if (time <= expiry && (best == null || time > best)) best = time;
  }
  return best;
}
