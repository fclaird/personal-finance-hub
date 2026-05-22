const USD2 = new Intl.NumberFormat(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const INT0 = new Intl.NumberFormat(undefined, { maximumFractionDigits: 0 });

export function maskUsd(): string {
  return "XXXXX";
}

export function formatInt(n: number | null | undefined): string {
  const v = typeof n === "number" ? n : n == null ? null : Number(n);
  if (v == null || !Number.isFinite(v)) return "-";
  return INT0.format(v);
}

export function formatNum(n: number | null | undefined, digits: number): string {
  const v = typeof n === "number" ? n : n == null ? null : Number(n);
  if (v == null || !Number.isFinite(v)) return "-";
  return new Intl.NumberFormat(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits }).format(v);
}

/**
 * Option intrinsic/extrinsic from the positions API (position totals in “premium dollars”).
 * Display in the **same scale as the option Price column**: dollars **per underlying share**
 * (`stored ÷ (100 × |contracts|)`), **no** `$`.
 */
export function formatOptionIntExtPerShare(
  value: number | null | undefined,
  quantity: number,
  opts?: { mask?: boolean },
): string {
  if (opts?.mask) return maskUsd();
  const n = typeof value === "number" ? value : value == null ? null : Number(value);
  const c = Math.abs(quantity);
  if (n == null || !Number.isFinite(n) || !c) return "—";
  return formatNum(n / (100 * c), 2);
}

export function formatUsd2(v: number | null | undefined, opts?: { mask?: boolean }): string {
  if (opts?.mask) return maskUsd();
  const n = typeof v === "number" ? v : v == null ? null : Number(v);
  if (n == null || !Number.isFinite(n)) return "-";
  return `$${USD2.format(n)}`;
}

export function formatUsdCompact(v: number | null | undefined, opts?: { mask?: boolean }): string {
  if (opts?.mask) return maskUsd();
  const n = typeof v === "number" ? v : v == null ? null : Number(v);
  if (n == null || !Number.isFinite(n)) return "-";
  const abs = Math.abs(n);
  const sign = n < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(2)}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2)}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2)}M`;
  if (abs >= 1e3) return `${sign}$${(abs / 1e3).toFixed(2)}K`;
  return `${sign}$${abs.toFixed(0)}`;
}

