export type ProfileBar = {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
};

export type ProfileBin = {
  low: number;
  high: number;
  up: number;
  down: number;
};

/**
 * Distribute each bar's volume uniformly across the price bins its range
 * overlaps. Up volume is a bar that closed at or above its open.
 */
export function volumeProfile(bars: readonly ProfileBar[], bins = 24): ProfileBin[] {
  const count = Math.max(1, Math.round(bins));
  if (bars.length === 0) return [];
  let min = Infinity;
  let max = -Infinity;
  for (const bar of bars) {
    if (bar.low < min) min = bar.low;
    if (bar.high > max) max = bar.high;
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return [];
  if (max === min) max = min + 1;
  const width = (max - min) / count;
  const out: ProfileBin[] = Array.from({ length: count }, (_, i) => ({
    low: min + i * width,
    high: min + (i + 1) * width,
    up: 0,
    down: 0,
  }));
  for (const bar of bars) {
    if (!(bar.volume > 0)) continue;
    const up = bar.close >= bar.open;
    const span = bar.high - bar.low;
    if (span <= 0) {
      const idx = Math.min(count - 1, Math.max(0, Math.floor((bar.close - min) / width)));
      if (up) out[idx]!.up += bar.volume;
      else out[idx]!.down += bar.volume;
      continue;
    }
    for (const bin of out) {
      const overlap = Math.min(bar.high, bin.high) - Math.max(bar.low, bin.low);
      if (overlap <= 0) continue;
      const share = bar.volume * (overlap / span);
      if (up) bin.up += share;
      else bin.down += share;
    }
  }
  return out;
}
