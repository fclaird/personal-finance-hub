export type VolumeSample = { readonly date: string; readonly volume: number };

export type LiquidityLine = {
  readonly symbol: string;
  readonly daysToLiquidate: number | null;
  readonly spreadCost: number | null;
  readonly volumeSource: string | null;
  readonly volumeAsOf: string | null;
  readonly quoteSource: string | null;
  readonly quoteAsOf: string | null;
  readonly reason: string | null;
};

/** Median positive daily share volume. A missing or zero sample stays blank. */
export function medianDailyVolume(samples: readonly VolumeSample[] | null): { readonly volume: number | null; readonly asOf: string | null } {
  if (!samples || samples.length === 0) return { volume: null, asOf: null };
  const positive = samples.filter((sample) => Number.isFinite(sample.volume) && sample.volume > 0).map((sample) => sample.volume).sort((a, b) => a - b);
  if (positive.length === 0) return { volume: null, asOf: null };
  const mid = Math.floor(positive.length / 2);
  const volume = positive.length % 2 === 1 ? positive[mid]! : (positive[mid - 1]! + positive[mid]!) / 2;
  const dates = samples.map((sample) => sample.date).sort();
  return { volume, asOf: `${dates[0]} through ${dates[dates.length - 1]}` };
}

export function positionLiquidity(input: {
  readonly symbol: string;
  readonly shares: number;
  readonly averageDailyVolume: number | null;
  readonly volumeSource: string | null;
  readonly volumeAsOf: string | null;
  readonly bid: number | null;
  readonly ask: number | null;
  readonly quoteSource: string | null;
  readonly quoteAsOf: string | null;
}): LiquidityLine {
  const days = input.averageDailyVolume != null && input.averageDailyVolume > 0 && Number.isFinite(input.shares) && input.shares !== 0
    ? Math.abs(input.shares) / input.averageDailyVolume
    : null;
  const spread = input.shares !== 0 && input.bid != null && input.ask != null && input.ask >= input.bid && input.bid >= 0
    ? Math.abs(input.shares) * (input.ask - input.bid) / 2
    : null;
  const reason = [
    days == null ? "Days to liquidate is blank. No positive average daily volume is on file." : null,
    spread == null ? "Spread cost is blank. No bid and ask are on file." : null,
  ].filter((line): line is string => line != null).join(" ");
  return {
    symbol: input.symbol,
    daysToLiquidate: days,
    spreadCost: spread,
    volumeSource: days == null ? null : input.volumeSource,
    volumeAsOf: days == null ? null : input.volumeAsOf,
    quoteSource: spread == null ? null : input.quoteSource,
    quoteAsOf: spread == null ? null : input.quoteAsOf,
    reason: reason || null,
  };
}
