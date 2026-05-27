export type PositionCostShareInput = {
  averagePrice?: number | null;
  price: number | null | undefined;
};

export function positionCostShare(row: PositionCostShareInput): number | null {
  if (row.averagePrice != null && Number.isFinite(row.averagePrice)) return row.averagePrice;
  if (row.price != null && Number.isFinite(row.price)) return row.price;
  return null;
}
