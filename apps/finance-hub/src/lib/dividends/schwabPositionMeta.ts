/** Parse Schwab `instrument.assetType` from a position metadata_json blob. */
export function parseSchwabAssetType(metadataJson: string | null): string | null {
  if (!metadataJson) return null;
  try {
    const j = JSON.parse(metadataJson) as { instrument?: { assetType?: unknown } };
    const at = j.instrument?.assetType;
    return typeof at === "string" && at.trim() ? at.trim().toUpperCase() : null;
  } catch {
    return null;
  }
}
