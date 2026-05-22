function layer(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

const WRAPPER_KEYS = new Set(["quote", "regular", "extended", "fundamental", "reference"]);

/**
 * Normalize a single Schwab `/quotes` entry: unwrap `quote`, then fill null fields from
 * `extended` (prefer first for after-hours gaps) and `regular`.
 */
export function schwabQuoteObjectFromEntry(entry: unknown): Record<string, unknown> | null {
  const root = layer(entry);
  if (!root) return null;

  const quote = layer(root.quote);
  let out: Record<string, unknown>;
  if (quote) {
    out = { ...quote };
  } else {
    out = { ...root };
    for (const k of WRAPPER_KEYS) delete out[k];
  }

  const mergeMissing = (src: Record<string, unknown> | null) => {
    if (!src) return;
    for (const [k, v] of Object.entries(src)) {
      if (WRAPPER_KEYS.has(k)) continue;
      if ((out[k] === undefined || out[k] === null) && v !== undefined && v !== null) {
        out[k] = v;
      }
    }
  };

  mergeMissing(layer(root.extended));
  mergeMissing(layer(root.regular));

  return Object.keys(out).length ? out : null;
}
