import { schwabQuoteDisplayPrice } from "@/lib/market/schwabQuoteDisplay";

/** Where the risk-profile graphic’s spot came from (chart-only; not used by Glance / option-risk). */
export type RiskChartSpotSource =
  | "schwab-extended"
  | "schwab-quote"
  | "schwab-regular"
  | "schwab-close"
  | "yahoo"
  | "fallback";

const WRAPPER_KEYS = new Set(["quote", "regular", "extended", "fundamental", "reference"]);

function layer(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

export function positivePx(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  if (typeof v === "string" && v.trim() !== "") {
    const n = Number(v);
    if (Number.isFinite(n) && n > 0) return n;
  }
  return null;
}

/** True when two prints are the same regular close (not a meaningful extended move). */
export function samePrint(a: number, b: number): boolean {
  const scale = Math.max(a, b, 1);
  return Math.abs(a - b) <= Math.max(0.01, scale * 0.0005);
}

function lastMarkFromLayer(src: Record<string, unknown> | null): number | null {
  if (!src) return null;
  const last = positivePx(src.lastPrice) ?? positivePx(src.regularMarketLastPrice);
  const mark = positivePx(src.mark);
  return schwabQuoteDisplayPrice(last, mark, null);
}

function quoteLayerFromEntry(root: Record<string, unknown>): Record<string, unknown> {
  const nested = layer(root.quote);
  if (nested) return nested;
  const flat: Record<string, unknown> = { ...root };
  for (const k of WRAPPER_KEYS) delete flat[k];
  return flat;
}

export type SchwabRiskChartSpot = {
  spot: number | null;
  close: number | null;
  source: Exclude<RiskChartSpotSource, "yahoo" | "fallback"> | null;
};

/**
 * Best available Schwab equity print for the PnL risk graphic.
 * When cash is closed, prefer the `extended` layer (pre/post/overnight) over `quote.lastPrice`
 * / `closePrice`, which are often last regular-session close. Does not change `/api/quotes` `last`.
 */
export function bestAvailableSpotFromSchwabEntry(
  entry: unknown,
  sessionOpen: boolean,
): SchwabRiskChartSpot {
  const root = layer(entry);
  if (!root) return { spot: null, close: null, source: null };

  const quoteLayer = quoteLayerFromEntry(root);
  const extendedLayer = layer(root.extended);
  const regularLayer = layer(root.regular);

  const extendedPx = lastMarkFromLayer(extendedLayer);
  const quotePx = lastMarkFromLayer(quoteLayer);
  const regularPx =
    positivePx(regularLayer?.regularMarketLastPrice) ?? lastMarkFromLayer(regularLayer);
  const close =
    positivePx(quoteLayer.closePrice) ??
    positivePx(root.closePrice) ??
    positivePx(regularLayer?.closePrice) ??
    null;

  const pick = (
    spot: number | null,
    source: SchwabRiskChartSpot["source"],
  ): SchwabRiskChartSpot => ({ spot, close, source: spot != null ? source : null });

  if (sessionOpen) {
    return pick(quotePx ?? extendedPx ?? regularPx ?? close, quotePx
      ? "schwab-quote"
      : extendedPx
        ? "schwab-extended"
        : regularPx
          ? "schwab-regular"
          : close
            ? "schwab-close"
            : null);
  }

  if (extendedPx != null) return pick(extendedPx, "schwab-extended");
  if (quotePx != null && (close == null || !samePrint(quotePx, close))) {
    return pick(quotePx, "schwab-quote");
  }
  if (regularPx != null && (close == null || !samePrint(regularPx, close))) {
    return pick(regularPx, "schwab-regular");
  }
  if (quotePx != null) return pick(quotePx, close != null && samePrint(quotePx, close) ? "schwab-close" : "schwab-quote");
  if (regularPx != null) return pick(regularPx, "schwab-regular");
  return pick(close, close != null ? "schwab-close" : null);
}

/** Yahoo chart meta: when cash is closed, prefer post/pre over regularMarketPrice (cash close). */
export function bestAvailableSpotFromYahooMeta(
  meta: Record<string, unknown> | null | undefined,
  sessionOpen: boolean,
): number | null {
  if (!meta) return null;
  const post = positivePx(meta.postMarketPrice);
  const pre = positivePx(meta.preMarketPrice);
  const regular = positivePx(meta.regularMarketPrice);
  if (sessionOpen) return regular ?? post ?? pre;
  return post ?? pre ?? regular;
}

export function yahooLastBarClose(result: Record<string, unknown> | null | undefined): number | null {
  if (!result) return null;
  const quote = (result.indicators as Record<string, unknown> | undefined)?.quote as
    | Array<Record<string, unknown>>
    | undefined;
  const closes = (quote?.[0]?.close as Array<number | null> | undefined) ?? [];
  for (let i = closes.length - 1; i >= 0; i--) {
    const c = positivePx(closes[i]);
    if (c != null) return c;
  }
  return null;
}

export function bestAvailableSpotFromYahooChartResult(
  result: Record<string, unknown> | null | undefined,
  sessionOpen: boolean,
): number | null {
  if (!result) return null;
  const meta = layer(result.meta);
  const fromMeta = bestAvailableSpotFromYahooMeta(meta, sessionOpen);
  if (fromMeta != null) return fromMeta;
  return yahooLastBarClose(result);
}

/**
 * Live quote wins; OHLCV / book spot is last-resort when no better print exists.
 * Used only by the risk-profile graphic.
 */
export function resolveRiskChartSpot(
  live: number | null | undefined,
  fallback: number | null | undefined,
): number | null {
  const L = live != null && Number.isFinite(live) && live > 0 ? live : null;
  if (L != null) return L;
  const F = fallback != null && Number.isFinite(fallback) && fallback > 0 ? fallback : null;
  return F;
}
