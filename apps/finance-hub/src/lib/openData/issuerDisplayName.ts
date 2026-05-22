/** Normalize ticker for lookups (uppercase, trimmed). */
export function normTicker(s: string): string {
  return (s ?? "").trim().toUpperCase();
}

/**
 * Turn issuer strings like "APPLE INC" or "MICROSOFT CORP" into readable display names.
 */
export function prettifyIssuerName(raw: string): string {
  const t = raw.trim();
  if (!t) return t;
  return t.split(/\s+/).map((w) => {
    const u = w.toUpperCase();
    if (u === "ETF" || u === "REIT" || u === "ADR" || u === "CEF" || u === "SPDR") return u;
    if (u === "INC" || u === "INC.") return "Inc.";
    if (u === "CORP" || u === "CORP.") return "Corp.";
    if (u === "CO" || u === "CO.") return "Co.";
    if (u === "LLC") return "LLC";
    if (u === "LP" || u === "L.P.") return "L.P.";
    if (u === "LTD" || u === "LTD.") return "Ltd.";
    if (u === "PLC") return "PLC";
    if (u === "NV") return "N.V.";
    if (u === "SA") return "S.A.";
    if (u === "AG") return "AG";
    return w.charAt(0).toUpperCase() + w.slice(1).toLowerCase();
  }).join(" ");
}
