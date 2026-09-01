export type HoldingYieldInput = {
  divYield: number | null;
  annualDivEst: number | null;
  last: number | null;
  shares: number | null;
  marketValue: number | null;
};

function holdingPrice(r: HoldingYieldInput): number | null {
  return (
    r.last ??
    (r.shares != null && r.shares > 0 && r.marketValue != null && r.marketValue > 0 ? r.marketValue / r.shares : null)
  );
}

/** Position dividend yield % from fundamentals or annual div / price. */
export function holdingYieldPct(r: HoldingYieldInput): number | null {
  const px = holdingPrice(r);
  if (r.divYield != null && Number.isFinite(r.divYield) && r.divYield >= 0) return r.divYield * 100;
  if (px != null && px > 0 && r.annualDivEst != null && Number.isFinite(r.annualDivEst) && r.annualDivEst >= 0) {
    return (r.annualDivEst / px) * 100;
  }
  return null;
}

/** Estimated annual dividend income for the position (per-share annual × shares). */
export function holdingAnnualDivUsd(r: HoldingYieldInput): number | null {
  if (
    r.annualDivEst != null &&
    r.shares != null &&
    Number.isFinite(r.annualDivEst) &&
    Number.isFinite(r.shares) &&
    r.shares > 0 &&
    r.annualDivEst >= 0
  ) {
    const v = r.annualDivEst * r.shares;
    return Number.isFinite(v) ? v : null;
  }
  const px = holdingPrice(r);
  if (
    r.divYield != null &&
    Number.isFinite(r.divYield) &&
    r.divYield >= 0 &&
    r.shares != null &&
    r.shares > 0 &&
    px != null &&
    px > 0
  ) {
    const v = r.divYield * px * r.shares;
    return Number.isFinite(v) ? v : null;
  }
  const yp = holdingYieldPct(r);
  if (yp != null && r.marketValue != null && r.marketValue > 0) {
    const v = (yp / 100) * r.marketValue;
    return Number.isFinite(v) && v >= 0 ? v : null;
  }
  return null;
}
