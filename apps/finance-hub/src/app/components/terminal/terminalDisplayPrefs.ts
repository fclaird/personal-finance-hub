import {
  DEFAULT_GLANCE_ALTERNATE_INSTRUMENT_ID,
  isGlanceAlternateInstrumentId,
  type GlanceAlternateInstrumentId,
} from "@/lib/market/glanceAlternateInstrumentIds";

const STOCKS_ONLY_KEY = "terminal_stocks_only_v1";
const LEGACY_HIDE_PASSIVE_FUNDS_KEY = "terminal_hide_passive_funds_v1";
const GLANCE_SOURCE_KEY = "terminal_glance_source_v1";
const GLANCE_VIEW_KEY = "terminal_glance_view_v1";
const GLANCE_ALTERNATE_INSTRUMENT_KEY = "terminal_glance_alternate_instrument_v1";
const WATCHLIST_ID_KEY = "terminal_watchlist_id_v1";
const QUOTES_SORT_KEY = "terminal_quotes_sort_v1";
const VOLUME_LEADERS_MODE_KEY = "terminal_volume_leaders_mode_v1";
const OPTION_FLOW_MODE_KEY = "terminal_option_flow_mode_v1";
const TABLE_COLUMN_ORDER_KEY = "terminal_table_column_order_v2";
const LEGACY_TABLE_COLUMN_ORDER_KEY = "terminal_table_column_order_v1";
const HEATMAP_HIDDEN_SYMBOLS_KEY = "terminal_heatmap_hidden_symbols_v1";

export type GlanceSourceMode = "markets" | "futures";
export type GlanceViewMode = "tiles" | "combined";
export type { GlanceAlternateInstrumentId };
export type QuotesSortCol = "symbol" | "company" | "last" | "chgPct" | "chg" | "volume" | "volX";
export type VolumeLeadersMode = "volume" | "volX";
export type OptionFlowMode = "volume" | "relative";

const QUOTES_SORT_COLS = new Set<QuotesSortCol>([
  "symbol",
  "company",
  "last",
  "chgPct",
  "chg",
  "volume",
  "volX",
]);

export function readGlanceSourceMode(): GlanceSourceMode {
  try {
    return localStorage.getItem(GLANCE_SOURCE_KEY) === "futures" ? "futures" : "markets";
  } catch {
    return "markets";
  }
}

export function writeGlanceSourceMode(mode: GlanceSourceMode): void {
  try {
    localStorage.setItem(GLANCE_SOURCE_KEY, mode);
  } catch {
    // ignore
  }
}

export function readGlanceViewMode(): GlanceViewMode {
  try {
    return localStorage.getItem(GLANCE_VIEW_KEY) === "combined" ? "combined" : "tiles";
  } catch {
    return "tiles";
  }
}

export function writeGlanceViewMode(mode: GlanceViewMode): void {
  try {
    localStorage.setItem(GLANCE_VIEW_KEY, mode);
  } catch {
    // ignore
  }
}

export function readGlanceAlternateInstrument(): GlanceAlternateInstrumentId {
  try {
    const raw = localStorage.getItem(GLANCE_ALTERNATE_INSTRUMENT_KEY);
    if (raw === "fitzy100") return "us-cl";
    if (raw && isGlanceAlternateInstrumentId(raw)) return raw;
  } catch {
    // ignore
  }
  return DEFAULT_GLANCE_ALTERNATE_INSTRUMENT_ID;
}

export function writeGlanceAlternateInstrument(id: GlanceAlternateInstrumentId): void {
  try {
    localStorage.setItem(GLANCE_ALTERNATE_INSTRUMENT_KEY, id);
  } catch {
    // ignore
  }
}

export function readStocksOnlyView(): boolean {
  try {
    if (localStorage.getItem(STOCKS_ONLY_KEY) === "1") return true;
    return localStorage.getItem(LEGACY_HIDE_PASSIVE_FUNDS_KEY) === "1";
  } catch {
    return false;
  }
}

export function writeStocksOnlyView(stocksOnly: boolean): void {
  try {
    localStorage.setItem(STOCKS_ONLY_KEY, stocksOnly ? "1" : "0");
    localStorage.setItem(LEGACY_HIDE_PASSIVE_FUNDS_KEY, stocksOnly ? "1" : "0");
  } catch {
    // ignore
  }
}

export function readWatchlistId(): string | null {
  try {
    const v = localStorage.getItem(WATCHLIST_ID_KEY)?.trim();
    return v ? v : null;
  } catch {
    return null;
  }
}

export function writeWatchlistId(id: string | null): void {
  try {
    if (id?.trim()) localStorage.setItem(WATCHLIST_ID_KEY, id.trim());
    else localStorage.removeItem(WATCHLIST_ID_KEY);
  } catch {
    // ignore
  }
}

export function readQuotesSort(): { col: QuotesSortCol; asc: boolean } {
  try {
    const raw = localStorage.getItem(QUOTES_SORT_KEY);
    if (!raw) return { col: "chgPct", asc: false };
    const parsed = JSON.parse(raw) as { col?: unknown; asc?: unknown };
    const col = typeof parsed.col === "string" && QUOTES_SORT_COLS.has(parsed.col as QuotesSortCol)
      ? (parsed.col as QuotesSortCol)
      : "chgPct";
    const asc = parsed.asc === true;
    return { col, asc };
  } catch {
    return { col: "chgPct", asc: false };
  }
}

export function writeQuotesSort(col: QuotesSortCol, asc: boolean): void {
  try {
    localStorage.setItem(QUOTES_SORT_KEY, JSON.stringify({ col, asc }));
  } catch {
    // ignore
  }
}

export function readVolumeLeadersMode(): VolumeLeadersMode {
  try {
    return localStorage.getItem(VOLUME_LEADERS_MODE_KEY) === "volX" ? "volX" : "volume";
  } catch {
    return "volume";
  }
}

export function writeVolumeLeadersMode(mode: VolumeLeadersMode): void {
  try {
    localStorage.setItem(VOLUME_LEADERS_MODE_KEY, mode);
  } catch {
    // ignore
  }
}

export function readOptionFlowMode(): OptionFlowMode {
  try {
    return localStorage.getItem(OPTION_FLOW_MODE_KEY) === "relative" ? "relative" : "volume";
  } catch {
    return "volume";
  }
}

export function writeOptionFlowMode(mode: OptionFlowMode): void {
  try {
    localStorage.setItem(OPTION_FLOW_MODE_KEY, mode);
  } catch {
    // ignore
  }
}

export function readTerminalTableColumnOrder(defaultOrder: readonly QuotesSortCol[]): QuotesSortCol[] {
  const allowed = new Set<QuotesSortCol>([
    "symbol",
    "company",
    "last",
    "chg",
    "chgPct",
    "volume",
    "volX",
  ]);
  const legacyAllowed = new Set<string>(["symbol", "last", "chg", "chgPct", "volume", "volX"]);

  function normalizeOrder(parsed: unknown): QuotesSortCol[] | null {
    if (!Array.isArray(parsed)) return null;
    let clean = parsed.filter((x) => typeof x === "string" && allowed.has(x as QuotesSortCol)) as QuotesSortCol[];
    if (clean.length === 0) {
      clean = parsed.filter((x) => typeof x === "string" && legacyAllowed.has(x as string)) as QuotesSortCol[];
    }
    if (clean.length === 0) return null;
    if (!clean.includes("company")) {
      const i = clean.indexOf("symbol");
      if (i >= 0) clean.splice(i + 1, 0, "company");
      else clean = ["symbol", "company", ...clean.filter((c) => c !== "symbol")];
    }
    for (const c of defaultOrder) {
      if (!clean.includes(c)) clean.push(c);
    }
    return clean;
  }

  try {
    const rawV2 = localStorage.getItem(TABLE_COLUMN_ORDER_KEY);
    if (rawV2) {
      const clean = normalizeOrder(JSON.parse(rawV2) as unknown);
      if (clean?.length) return clean;
    }
    const rawV1 = localStorage.getItem(LEGACY_TABLE_COLUMN_ORDER_KEY);
    if (rawV1) {
      const clean = normalizeOrder(JSON.parse(rawV1) as unknown);
      if (clean?.length) return clean;
    }
  } catch {
    // ignore
  }
  return [...defaultOrder];
}

export function writeTerminalTableColumnOrder(order: readonly QuotesSortCol[]): void {
  try {
    localStorage.setItem(TABLE_COLUMN_ORDER_KEY, JSON.stringify(order));
  } catch {
    // ignore
  }
}

function normalizeSymbolList(parsed: unknown): string[] {
  if (!Array.isArray(parsed)) return [];
  return [
    ...new Set(
      parsed
        .filter((x): x is string => typeof x === "string")
        .map((s) => s.trim().toUpperCase())
        .filter(Boolean),
    ),
  ];
}

/** Symbols manually hidden from the terminal heatmap / treemap (visual only). */
export function readHeatmapHiddenSymbols(): Set<string> {
  try {
    const raw = localStorage.getItem(HEATMAP_HIDDEN_SYMBOLS_KEY);
    if (!raw) return new Set();
    return new Set(normalizeSymbolList(JSON.parse(raw) as unknown));
  } catch {
    return new Set();
  }
}

export function writeHeatmapHiddenSymbols(symbols: ReadonlySet<string>): void {
  try {
    const list = [...symbols].map((s) => s.trim().toUpperCase()).filter(Boolean).sort();
    if (list.length === 0) localStorage.removeItem(HEATMAP_HIDDEN_SYMBOLS_KEY);
    else localStorage.setItem(HEATMAP_HIDDEN_SYMBOLS_KEY, JSON.stringify(list));
  } catch {
    // ignore
  }
}
