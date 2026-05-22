/**
 * Demo portfolio: explicit per-contract delta targets (Black–Scholes-style option delta).
 * Snapshot index `i` (0..2) nudges values slightly across historical demo snapshots.
 */
export const DemoOptionDelta = {
  aaplLongCall: (i: number) => 0.52 + i * 0.015,
  aaplShortPut: (i: number) => -0.38 - i * 0.012,
  tslaCoveredCall: (i: number) => -0.4 - i * 0.012,
  pltrLongDatedCc: (i: number) => -0.1 - i * 0.006,
  rklbCoveredCall: (i: number) => -0.22 - i * 0.01,
  rklbCashSecuredPut: (i: number) => -0.24 - i * 0.01,
  vgShortCallLadder: (i: number) => -0.12 - i * 0.006,
  bmnrShortPut: (i: number) => -0.565 - i * 0.005,
  bmnrShortCall: (i: number) => 0.34 + i * 0.006,
  nbisShortCall: (i: number) => -0.28 - i * 0.01,
  nbisShortPut: (i: number) => -0.4 - i * 0.01,
  amznCoveredCall: (i: number) => -0.32 - i * 0.01,
  msftCoveredCall: (i: number) => -0.29 - i * 0.01,
  orcCoveredCall: (i: number) => -0.18 - i * 0.008,
} as const;
