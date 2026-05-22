/** Parsed `dividend_model_portfolios.meta_json` for Schwab slice linking. */
export type DividendPortfolioMeta = {
  sliceAccountId?: string | null;
};

export function parsePortfolioMeta(raw: string | null | undefined): DividendPortfolioMeta {
  if (raw == null || !String(raw).trim()) return {};
  try {
    const j = JSON.parse(String(raw)) as Record<string, unknown>;
    const id = j.sliceAccountId;
    if (typeof id === "string" && id.trim()) return { sliceAccountId: id.trim() };
    if (id === null) return { sliceAccountId: null };
    return {};
  } catch {
    return {};
  }
}

export function stringifyPortfolioMeta(meta: DividendPortfolioMeta): string | null {
  const o: Record<string, unknown> = {};
  if (meta.sliceAccountId != null && meta.sliceAccountId !== "") {
    o.sliceAccountId = meta.sliceAccountId;
  }
  return Object.keys(o).length > 0 ? JSON.stringify(o) : null;
}
