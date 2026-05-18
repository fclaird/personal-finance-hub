import { schwabQuoteObjectFromEntry } from "@/lib/schwab/quoteEntry";

function layer(v: unknown): Record<string, unknown> | null {
  if (v && typeof v === "object" && !Array.isArray(v)) return v as Record<string, unknown>;
  return null;
}

function pickName(o: Record<string, unknown> | null): string | null {
  if (!o) return null;
  for (const key of ["description", "companyName", "symbolDescription", "name", "longName", "shortName"]) {
    const v = o[key];
    if (typeof v === "string") {
      const s = v.trim();
      if (s && s.toLowerCase() !== "n/a") return s;
    }
  }
  return null;
}

/** Company / security label from a Schwab `/quotes` entry (reference, fundamental, or quote layers). */
export function schwabCompanyNameFromQuoteEntry(entry: unknown): string | null {
  const root = layer(entry);
  if (!root) return null;

  const fromRef = pickName(layer(root.reference));
  if (fromRef) return fromRef;

  const fromFund = pickName(layer(root.fundamental));
  if (fromFund) return fromFund;

  const fromQuote = pickName(schwabQuoteObjectFromEntry(entry));
  if (fromQuote) return fromQuote;

  return pickName(root);
}
