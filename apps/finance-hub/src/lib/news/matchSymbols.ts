function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** True when headline/body text likely refers to a ticker (and optionally company name). */
export function textMatchesSymbol(text: string, sym: string, companyName: string | null): boolean {
  const t = text ?? "";
  const s = (sym ?? "").trim().toUpperCase();
  if (!s) return false;
  const upper = t.toUpperCase();
  if (upper.includes(`$${s}`)) return true;
  if (s.length <= 2) return false;
  const re = new RegExp(`\\b${escapeRe(s)}\\b`, "i");
  if (re.test(t)) return true;
  const cn = (companyName ?? "").trim();
  if (cn.length < 4) return false;
  const parts = cn.split(/\s+/).filter((w) => w.length > 3);
  for (const w of parts) {
    if (t.toLowerCase().includes(w.toLowerCase())) return true;
  }
  return false;
}

/** @deprecated alias */
export function headlineMatchesSymbol(title: string, sym: string, companyName: string | null): boolean {
  return textMatchesSymbol(title, sym, companyName);
}
