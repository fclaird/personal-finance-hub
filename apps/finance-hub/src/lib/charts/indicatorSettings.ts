import {
  BB_COLOR,
  BMSB_EMA,
  BMSB_SMA,
  ICHIMOKU_BASE,
  ICHIMOKU_CONVERSION,
  ICHIMOKU_LAGGING,
  ICHIMOKU_SPAN_A,
  ICHIMOKU_SPAN_B,
  SMA_100,
  SMA_20,
  SMA_200,
  SMA_50,
  VWAP_COLOR,
  CANDLE_DOWN,
  CANDLE_UP,
} from "@/lib/charts/palette";

export type LineWidthSetting = 1 | 2 | 3 | 4;

export type MaSetting = {
  period: number;
  color: string;
  width: LineWidthSetting;
  visible: boolean;
};

export type IndicatorSettings = {
  ma: MaSetting[];
  ichimoku: {
    visible: boolean;
    conversion: number;
    base: number;
    span: number;
    displacement: number;
    width: LineWidthSetting;
    conversionColor: string;
    baseColor: string;
    spanAColor: string;
    spanBColor: string;
    laggingColor: string;
  };
  bb: {
    visible: boolean;
    period: number;
    mult: number;
    color: string;
    width: LineWidthSetting;
  };
  bmsb: {
    visible: boolean;
    smaPeriod: number;
    emaPeriod: number;
    smaColor: string;
    emaColor: string;
    width: LineWidthSetting;
  };
  vwap: { visible: boolean; color: string; width: LineWidthSetting };
  volume: { visible: boolean; up: string; down: string };
  profile: { visible: boolean; bins: number; up: string; down: string };
  book: { visible: boolean };
};

export const DEFAULT_INDICATORS: IndicatorSettings = {
  ma: [
    { period: 20, color: SMA_20, width: 2, visible: true },
    { period: 50, color: SMA_50, width: 2, visible: true },
    { period: 100, color: SMA_100, width: 2, visible: true },
    { period: 200, color: SMA_200, width: 2, visible: true },
  ],
  ichimoku: {
    visible: true,
    conversion: 9,
    base: 26,
    span: 52,
    displacement: 26,
    width: 2,
    conversionColor: ICHIMOKU_CONVERSION,
    baseColor: ICHIMOKU_BASE,
    spanAColor: ICHIMOKU_SPAN_A,
    spanBColor: ICHIMOKU_SPAN_B,
    laggingColor: ICHIMOKU_LAGGING,
  },
  bb: { visible: false, period: 20, mult: 2, color: BB_COLOR, width: 2 },
  bmsb: {
    visible: false,
    smaPeriod: 20,
    emaPeriod: 21,
    smaColor: BMSB_SMA,
    emaColor: BMSB_EMA,
    width: 2,
  },
  vwap: { visible: false, color: VWAP_COLOR, width: 2 },
  volume: { visible: false, up: CANDLE_UP, down: CANDLE_DOWN },
  profile: { visible: false, bins: 24, up: CANDLE_UP, down: CANDLE_DOWN },
  book: { visible: true },
};

function clampInt(value: unknown, min: number, max: number, fallback: number): number {
  const n = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, Math.round(n)));
}

function clampWidth(value: unknown, fallback: LineWidthSetting): LineWidthSetting {
  const n = clampInt(value, 1, 4, fallback);
  return n as LineWidthSetting;
}

function colorOr(value: unknown, fallback: string): string {
  return typeof value === "string" && /^#[0-9a-fA-F]{6}$/.test(value) ? value : fallback;
}

function flag(value: unknown, fallback: boolean): boolean {
  return typeof value === "boolean" ? value : fallback;
}

export function sanitizeIndicatorSettings(raw: unknown): IndicatorSettings {
  const base = DEFAULT_INDICATORS;
  const src = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  const maRaw = Array.isArray(src.ma) ? src.ma : [];
  const ma = base.ma.map((item, i) => {
    const row = maRaw[i] && typeof maRaw[i] === "object" ? (maRaw[i] as Record<string, unknown>) : {};
    return {
      period: clampInt(row.period, 1, 400, item.period),
      color: colorOr(row.color, item.color),
      width: clampWidth(row.width, item.width),
      visible: flag(row.visible, item.visible),
    };
  });
  const ich = src.ichimoku && typeof src.ichimoku === "object" ? (src.ichimoku as Record<string, unknown>) : {};
  const bb = src.bb && typeof src.bb === "object" ? (src.bb as Record<string, unknown>) : {};
  const bmsb = src.bmsb && typeof src.bmsb === "object" ? (src.bmsb as Record<string, unknown>) : {};
  const vwap = src.vwap && typeof src.vwap === "object" ? (src.vwap as Record<string, unknown>) : {};
  const volume = src.volume && typeof src.volume === "object" ? (src.volume as Record<string, unknown>) : {};
  const profile = src.profile && typeof src.profile === "object" ? (src.profile as Record<string, unknown>) : {};
  const book = src.book && typeof src.book === "object" ? (src.book as Record<string, unknown>) : {};
  return {
    ma,
    ichimoku: {
      visible: flag(ich.visible, base.ichimoku.visible),
      conversion: clampInt(ich.conversion, 1, 200, base.ichimoku.conversion),
      base: clampInt(ich.base, 1, 200, base.ichimoku.base),
      span: clampInt(ich.span, 1, 400, base.ichimoku.span),
      displacement: clampInt(ich.displacement, 1, 100, base.ichimoku.displacement),
      width: clampWidth(ich.width, base.ichimoku.width),
      conversionColor: colorOr(ich.conversionColor, base.ichimoku.conversionColor),
      baseColor: colorOr(ich.baseColor, base.ichimoku.baseColor),
      spanAColor: colorOr(ich.spanAColor, base.ichimoku.spanAColor),
      spanBColor: colorOr(ich.spanBColor, base.ichimoku.spanBColor),
      laggingColor: colorOr(ich.laggingColor, base.ichimoku.laggingColor),
    },
    bb: {
      visible: flag(bb.visible, base.bb.visible),
      period: clampInt(bb.period, 2, 400, base.bb.period),
      mult: Math.min(5, Math.max(0.5, Number.isFinite(Number(bb.mult)) ? Number(bb.mult) : base.bb.mult)),
      color: colorOr(bb.color, base.bb.color),
      width: clampWidth(bb.width, base.bb.width),
    },
    bmsb: {
      visible: flag(bmsb.visible, base.bmsb.visible),
      smaPeriod: clampInt(bmsb.smaPeriod, 2, 100, base.bmsb.smaPeriod),
      emaPeriod: clampInt(bmsb.emaPeriod, 2, 100, base.bmsb.emaPeriod),
      smaColor: colorOr(bmsb.smaColor, base.bmsb.smaColor),
      emaColor: colorOr(bmsb.emaColor, base.bmsb.emaColor),
      width: clampWidth(bmsb.width, base.bmsb.width),
    },
    vwap: {
      visible: flag(vwap.visible, base.vwap.visible),
      color: colorOr(vwap.color, base.vwap.color),
      width: clampWidth(vwap.width, base.vwap.width),
    },
    volume: {
      visible: flag(volume.visible, base.volume.visible),
      up: colorOr(volume.up, base.volume.up),
      down: colorOr(volume.down, base.volume.down),
    },
    profile: {
      visible: flag(profile.visible, base.profile.visible),
      bins: clampInt(profile.bins, 8, 80, base.profile.bins),
      up: colorOr(profile.up, base.profile.up),
      down: colorOr(profile.down, base.profile.down),
    },
    book: { visible: flag(book.visible, base.book.visible) },
  };
}
