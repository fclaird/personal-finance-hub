/** Normalize issuer names for Wikipedia / Wikidata search (drop share class noise). */
export function cleanIssuerSearchName(name: string): string {
  let s = (name ?? "").trim();
  if (!s) return s;
  s = s.replace(/\s+inc\s*[-–]?\s*cl\s+[a-z0-9.]+\s*$/i, " Inc");
  s = s.replace(/\s*[-–]\s*cl\s+[a-z0-9.]+\s*$/i, "");
  s = s.replace(/\s+class\s+[a-z0-9.]+\s*$/i, "");
  s = s.replace(/\s*,?\s*inc\.?\s*$/i, " Inc");
  s = s.replace(/\s+/g, " ").trim();
  return s;
}

/**
 * Trim narrative text to a short, readable “what they do” blurb (2–3 sentences).
 */
export function toConciseBusinessSummary(
  text: string,
  opts?: { maxSentences?: number; maxChars?: number },
): string {
  const maxSentences = opts?.maxSentences ?? 3;
  const maxChars = opts?.maxChars ?? 520;
  const cleaned = text.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  if (cleaned.length <= maxChars) return cleaned;

  const sentences = cleaned.split(/(?<=[.!?])\s+/).filter((s) => s.trim().length > 20);
  let out = "";
  let count = 0;
  for (const s of sentences) {
    const next = out ? `${out} ${s}` : s;
    if (next.length > maxChars && out) break;
    out = next;
    count += 1;
    if (count >= maxSentences) break;
  }
  if (!out) return cleaned.slice(0, maxChars - 1).trimEnd() + "…";
  if (out.length > maxChars) return out.slice(0, maxChars - 1).trimEnd() + "…";
  return out.endsWith(".") ? out : `${out}.`;
}
