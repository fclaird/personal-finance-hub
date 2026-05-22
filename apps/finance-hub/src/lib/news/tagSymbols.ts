import { extractDollarTickers } from "./parseIngestText";
import { textMatchesSymbol } from "./matchSymbols";

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match tickers from a held-symbol watchlist (word boundary, length >= 3). */
export function tagSymbolsFromHeldList(text: string, heldSymbols: string[]): string[] {
  const upper = (text ?? "").toUpperCase();
  const out = new Set<string>();
  for (const raw of heldSymbols) {
    const s = raw.trim().toUpperCase();
    if (s.length < 3 || s.length > 5) continue;
    const re = new RegExp(`\\b${escapeRe(s)}\\b`);
    if (re.test(upper)) out.add(s);
  }
  return [...out];
}

export function tagSymbolsForIngest(
  title: string,
  body: string,
  heldSymbols: string[],
  companyNamesBySymbol?: Map<string, string>,
): string[] {
  const combined = `${title}\n${body}`;
  const out = new Set<string>(extractDollarTickers(combined));
  for (const s of tagSymbolsFromHeldList(combined, heldSymbols)) out.add(s);
  if (companyNamesBySymbol) {
    for (const [sym, name] of companyNamesBySymbol) {
      if (textMatchesSymbol(combined, sym, name)) out.add(sym.toUpperCase());
    }
  }
  return [...out].sort();
}
