export type SourcedValue = {
  readonly value: string | null;
  readonly source: string | null;
  readonly asOf: string | null;
};

export type SourcedName = {
  readonly symbol: string;
  readonly sector: SourcedValue;
  readonly rates: SourcedValue;
  readonly geography: SourcedValue;
};

const blank: SourcedValue = { value: null, source: null, asOf: null };

/** A value with no source, no date, or a demo source is left blank. */
export function sourcedValue(value: string | number | null | undefined, source: string | null | undefined, asOf: string | null | undefined): SourcedValue {
  if (value == null || value === "") return blank;
  if (source == null || source.trim() === "" || asOf == null || asOf.trim() === "") return blank;
  if (/demo/i.test(source)) return blank;
  return { value: String(value), source: source.trim(), asOf: asOf.trim() };
}

export function sourcedName(input: {
  readonly symbol: string;
  readonly sector?: string | null;
  readonly sectorSource?: string | null;
  readonly sectorAsOf?: string | null;
  readonly rateExposure?: string | null;
  readonly rateSource?: string | null;
  readonly rateAsOf?: string | null;
  readonly geography?: string | null;
  readonly geographySource?: string | null;
  readonly geographyAsOf?: string | null;
}): SourcedName {
  return {
    symbol: input.symbol.trim().toUpperCase(),
    sector: sourcedValue(input.sector, input.sectorSource, input.sectorAsOf),
    rates: sourcedValue(input.rateExposure, input.rateSource, input.rateAsOf),
    geography: sourcedValue(input.geography, input.geographySource, input.geographyAsOf),
  };
}
