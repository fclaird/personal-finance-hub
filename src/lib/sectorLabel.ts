/**
 * Sector labels shown in diversification / taxonomy pies.
 * "Other" is not a valid bucket — treat as unknown so holdings need explicit classification.
 */
export function normalizeSectorLabel(sector: string | null | undefined): string {
  const s = (sector ?? "").trim();
  if (!s) return "Unknown";
  if (s.toLowerCase() === "other") return "Unknown";
  return s;
}
