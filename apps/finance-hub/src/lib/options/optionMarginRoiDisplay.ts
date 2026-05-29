import { computeOptionMarginRoi } from "@/lib/options/optionMarginRoi";

export type OptionMarginRoiRow = {
  securityType: string;
  quantity: number;
  optionStrike: number | null;
  averagePrice?: number | null;
  dte: number | null;
};

export function optionMarginRoiForRow(row: OptionMarginRoiRow) {
  if (row.securityType !== "option") return null;
  const entry =
    row.averagePrice != null && Number.isFinite(row.averagePrice) ? row.averagePrice : null;
  return computeOptionMarginRoi({
    quantity: row.quantity,
    optionStrike: row.optionStrike,
    entryPricePerShare: entry,
    dte: row.dte,
  });
}
