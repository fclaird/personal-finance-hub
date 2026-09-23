const DEFAULT_OPTION_CONTRACT_MULTIPLIER = 100;

function positiveMultiplier(v: unknown): number | null {
  if (typeof v === "number" && Number.isFinite(v) && v > 0) return v;
  return null;
}

type OptionPositionMetadata = {
  multiplier?: unknown;
  optionMultiplier?: unknown;
  instrument?: {
    multiplier?: unknown;
    optionMultiplier?: unknown;
  } | null;
};

export function resolveOptionContractMultiplier(metadataJson: string | null | undefined): number {
  if (!metadataJson) return DEFAULT_OPTION_CONTRACT_MULTIPLIER;
  try {
    const meta = JSON.parse(metadataJson) as OptionPositionMetadata;
    const instrument = meta.instrument ?? null;
    return (
      positiveMultiplier(meta.multiplier) ??
      positiveMultiplier(meta.optionMultiplier) ??
      positiveMultiplier(instrument?.optionMultiplier) ??
      positiveMultiplier(instrument?.multiplier) ??
      DEFAULT_OPTION_CONTRACT_MULTIPLIER
    );
  } catch {
    return DEFAULT_OPTION_CONTRACT_MULTIPLIER;
  }
}

export function optionMarketValueFromMark(mark: number, quantity: number, multiplier: number): number {
  const mult = positiveMultiplier(multiplier) ?? DEFAULT_OPTION_CONTRACT_MULTIPLIER;
  return mark * mult * quantity;
}

export function optionMarkFromMarketValue(
  marketValue: number,
  quantity: number,
  multiplier: number,
): number | null {
  if (!Number.isFinite(marketValue) || !Number.isFinite(quantity) || quantity === 0) return null;
  const mult = positiveMultiplier(multiplier) ?? DEFAULT_OPTION_CONTRACT_MULTIPLIER;
  const mark = marketValue / (quantity * mult);
  return Number.isFinite(mark) ? mark : null;
}
