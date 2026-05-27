import type { UsMarketGlanceItem } from "@/app/components/terminal/MarketGlanceCard";

const GLANCE_CHART_BASELINE = 100;
/** Gaps longer than this are non-trading (overnight); do not connect lines across them. */
const TRADING_GAP_MS = 45 * 60 * 1000;

export type TileChartRow = {
  idx: number;
  regular: number | null;
  extended: number | null;
  tsMs?: number;
  segment: "prior" | "regular" | "extended";
  gainFill?: number | null;
  lossFill?: number | null;
  extGainFill?: number | null;
  extLossFill?: number | null;
  gainStroke?: number | null;
  lossStroke?: number | null;
  extGainStroke?: number | null;
  extLossStroke?: number | null;
};

function hasTradingGap(beforeTs: number | undefined, afterTs: number | undefined): boolean {
  if (beforeTs == null || afterTs == null || !Number.isFinite(beforeTs) || !Number.isFinite(afterTs)) {
    return false;
  }
  return afterTs - beforeTs > TRADING_GAP_MS;
}

export function reindexTileChartRows(rows: TileChartRow[]): TileChartRow[] {
  return rows.map((row, idx) => ({ ...row, idx }));
}

function nearPrice(a: number, b: number): boolean {
  const ref = Math.max(Math.abs(a), Math.abs(b), 1e-9);
  return Math.abs(a - b) / ref < 0.00005;
}

export function isIndexedGlanceChartItem(item: UsMarketGlanceItem): boolean {
  return item.id === "portfolio" || item.valueMode === "percent";
}

export function resolvePriorSessionClose(item: UsMarketGlanceItem): number | null {
  if (item.previousClose == null || !Number.isFinite(item.previousClose)) return null;
  return item.previousClose;
}

export function indexTileChartValue(
  value: number | null | undefined,
  previousClose: number | null,
  alreadyIndexed: boolean,
): number | null {
  if (value == null || !Number.isFinite(value)) return null;
  if (alreadyIndexed || previousClose == null || !Number.isFinite(previousClose) || previousClose === 0) {
    return value;
  }
  return (value / previousClose) * GLANCE_CHART_BASELINE;
}

/** Map tile rows to indexed scale (100 = prior close) so cross-tile moves are comparable. */
export function indexTileChartRows(rows: TileChartRow[], item: UsMarketGlanceItem): TileChartRow[] {
  const previousClose = resolvePriorSessionClose(item);
  const alreadyIndexed = isIndexedGlanceChartItem(item);
  return rows.map((row) => ({
    ...row,
    regular: indexTileChartValue(row.regular, previousClose, alreadyIndexed),
    extended: indexTileChartValue(row.extended, previousClose, alreadyIndexed),
  }));
}

/** RTH path in regular column; pre/post in extended (gray). Prior close anchors the left. */
export function buildTileChartRows(
  item: UsMarketGlanceItem,
  options?: { omitPriorAnchor?: boolean },
): TileChartRow[] {
  const prev = item.previousClose;
  const rows: TileChartRow[] = [];

  if (prev != null && Number.isFinite(prev) && !options?.omitPriorAnchor) {
    rows.push({ idx: 0, regular: prev, extended: null, segment: "prior" });
  }

  for (const p of item.series) {
    if (rows.length === 1 && prev != null && nearPrice(p.close, prev)) continue;
    const lastRow = rows[rows.length - 1];
    if (lastRow?.tsMs != null && p.tsMs != null && hasTradingGap(lastRow.tsMs, p.tsMs)) {
      rows.push({
        idx: rows.length,
        regular: null,
        extended: null,
        segment: "regular",
      });
    }
    const tail = rows[rows.length - 1]?.regular;
    if (tail != null && nearPrice(p.close, tail)) continue;
    rows.push({
      idx: rows.length,
      regular: p.close,
      extended: null,
      tsMs: p.tsMs,
      segment: "regular",
    });
  }

  const ext = item.extendedSeries ?? [];
  if (ext.length < 2) return reindexTileChartRows(rows);

  const lastRow = rows[rows.length - 1];
  const anchor = lastRow?.regular ?? item.sessionClose;
  let start = 0;

  const nextExtTs = ext.length > 1 ? ext[1]!.tsMs : ext[0]!.tsMs;
  const canAttachAtClose =
    lastRow != null &&
    ext[0] != null &&
    anchor != null &&
    !hasTradingGap(lastRow.tsMs, nextExtTs);

  if (canAttachAtClose) {
    lastRow.extended = nearPrice(ext[0]!.close, anchor) ? anchor : ext[0]!.close;
    lastRow.tsMs = lastRow.tsMs ?? ext[0]!.tsMs;
    start = 1;
  } else if (ext[0] != null && anchor != null && nearPrice(ext[0].close, anchor)) {
    start = 1;
  }

  if (start < ext.length && hasTradingGap(lastRow?.tsMs, ext[start]!.tsMs)) {
    rows.push({
      idx: rows.length,
      regular: null,
      extended: null,
      segment: "extended",
    });
  }

  for (let i = start; i < ext.length; i++) {
    if (i > start && hasTradingGap(ext[i - 1]!.tsMs, ext[i]!.tsMs)) {
      rows.push({
        idx: rows.length,
        regular: null,
        extended: null,
        segment: "extended",
      });
    }
    rows.push({
      idx: rows.length,
      regular: null,
      extended: ext[i]!.close,
      tsMs: ext[i]!.tsMs,
      segment: "extended",
    });
  }

  return reindexTileChartRows(rows);
}
