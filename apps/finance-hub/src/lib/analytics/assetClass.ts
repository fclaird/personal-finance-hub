export type AssetClass = "equity" | "fund" | "bond" | "cash" | "option" | "other";

function normalizeAssetType(raw: unknown): string {
  return typeof raw === "string" ? raw.toUpperCase() : "";
}

/** Map security_type + optional Schwab metadata to allocation asset class. */
export function classifyAsset(securityType: string, metadataJson: string | null): AssetClass {
  const st = (securityType ?? "").toLowerCase();
  if (st === "option") return "option";
  if (st === "equity") return "equity";
  if (st === "fund") return "fund";
  if (st === "cash") return "cash";
  if (st === "bond" || st === "fixed_income") return "bond";

  if (!metadataJson) return "other";
  try {
    const parsed = JSON.parse(metadataJson) as { instrument?: { assetType?: unknown } };
    const t = normalizeAssetType(parsed?.instrument?.assetType);
    if (t.includes("CASH")) return "cash";
    if (t.includes("MUTUAL_FUND") || t.includes("ETF") || t.includes("FUND")) return "fund";
    if (t.includes("FIXED_INCOME") || t.includes("BOND")) return "bond";
    if (t.includes("EQUITY")) return "equity";
    if (t.includes("OPTION")) return "option";
    return "other";
  } catch {
    return "other";
  }
}
