const OPTION_MULTIPLIER = 100;

export function optionContractsAbs(quantity: number): number | null {
  if (!Number.isFinite(quantity) || quantity === 0) return null;
  return Math.abs(quantity);
}

/** Cash-secured style: |qty| × strike × 100. */
export function optionMarginSecuredDollars(quantity: number, strike: number | null): number | null {
  const contracts = optionContractsAbs(quantity);
  if (contracts == null || strike == null || !Number.isFinite(strike) || strike <= 0) return null;
  return contracts * strike * OPTION_MULTIPLIER;
}

/** Premium received (or paid) at entry: |qty| × 100 × entry per share. */
export function optionPremiumCashReceived(
  quantity: number,
  entryPricePerShare: number | null,
): number | null {
  const contracts = optionContractsAbs(quantity);
  if (contracts == null || entryPricePerShare == null || !Number.isFinite(entryPricePerShare)) return null;
  return contracts * OPTION_MULTIPLIER * Math.abs(entryPricePerShare);
}

export function optionRoiOnMarginPct(cashReceived: number, marginSecured: number): number | null {
  if (
    !Number.isFinite(cashReceived) ||
    !Number.isFinite(marginSecured) ||
    marginSecured <= 0 ||
    cashReceived < 0
  ) {
    return null;
  }
  return (cashReceived / marginSecured) * 100;
}

/** Simple annualization: ROI% × (365 / DTE). */
export function optionAnnualizedRoiPct(roiPct: number, dte: number | null): number | null {
  if (!Number.isFinite(roiPct)) return null;
  const days = dte != null && Number.isFinite(dte) ? Math.max(dte, 1) : 1;
  return roiPct * (365 / days);
}

export type OptionMarginRoiComputed = {
  marginSecured: number;
  cashReceived: number;
  roiPct: number;
  annualizedRoiPct: number;
};

export function computeOptionMarginRoi(input: {
  quantity: number;
  optionStrike: number | null;
  entryPricePerShare: number | null;
  dte: number | null;
}): OptionMarginRoiComputed | null {
  if (input.quantity >= 0) return null;
  const marginSecured = optionMarginSecuredDollars(input.quantity, input.optionStrike);
  const cashReceived = optionPremiumCashReceived(input.quantity, input.entryPricePerShare);
  if (marginSecured == null || cashReceived == null) return null;
  const roiPct = optionRoiOnMarginPct(cashReceived, marginSecured);
  if (roiPct == null) return null;
  const annualizedRoiPct = optionAnnualizedRoiPct(roiPct, input.dte);
  if (annualizedRoiPct == null) return null;
  return { marginSecured, cashReceived, roiPct, annualizedRoiPct };
}
