export type NetWorthProperty = {
  officialValue: number | null;
  loanBalance: number;
};

export type NetWorthStrip = {
  status: "ready" | "incomplete";
  investable: number;
  realEstateAssets: number | null;
  mortgage: number;
  netWorth: number | null;
};

/**
 * Net worth is investable assets plus real-estate market value minus mortgage principal.
 * It stays unpublished until every property has an official value.
 */
export function composeNetWorth(investable: number, properties: NetWorthProperty[]): NetWorthStrip {
  const mortgage = properties.reduce((sum, property) => sum + property.loanBalance, 0);
  const ready =
    properties.length > 0 &&
    properties.every((property) => property.officialValue != null && Number.isFinite(property.officialValue));
  if (!ready) {
    return { status: "incomplete", investable, realEstateAssets: null, mortgage, netWorth: null };
  }
  const realEstateAssets = properties.reduce((sum, property) => sum + (property.officialValue ?? 0), 0);
  return {
    status: "ready",
    investable,
    realEstateAssets,
    mortgage,
    netWorth: investable + realEstateAssets - mortgage,
  };
}
