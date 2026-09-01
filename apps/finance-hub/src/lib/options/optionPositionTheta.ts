const OPTION_MULTIPLIER = 100;

export type OptionPositionThetaInput = {
  securityType: string;
  theta: number | null | undefined;
  quantity: number | null | undefined;
};

/** Position-level theta in dollars per day (per-share θ × contracts × 100). */
export function optionPositionTheta(row: OptionPositionThetaInput): number | null {
  if (row.securityType !== "option") return null;
  const theta = row.theta;
  const qty = row.quantity;
  if (theta == null || !Number.isFinite(theta)) return null;
  if (qty == null || !Number.isFinite(qty)) return null;
  return theta * qty * OPTION_MULTIPLIER;
}
