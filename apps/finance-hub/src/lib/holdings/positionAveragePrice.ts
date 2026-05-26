/** Schwab sync stores averagePrice in metadata; greeks refresh may overwrite positions.price with mark. */
export function resolvePositionAveragePrice(
  storedPrice: number | null | undefined,
  metadataJson: string | null | undefined,
): number | null {
  if (metadataJson) {
    try {
      const meta = JSON.parse(metadataJson) as { averagePrice?: unknown };
      if (typeof meta.averagePrice === "number" && Number.isFinite(meta.averagePrice)) {
        return meta.averagePrice;
      }
    } catch {
      // fall through
    }
  }
  if (storedPrice != null && Number.isFinite(storedPrice)) return storedPrice;
  return null;
}
