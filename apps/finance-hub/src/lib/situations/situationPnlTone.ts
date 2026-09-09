import { posNegClass } from "@/lib/terminal/colors";

/** Cashflow fill lines (open credit, BTC debit, etc.) — never a P/L signal. */
export const SITUATION_FILL_CASHFLOW_CLASS = "text-zinc-600 dark:text-zinc-300";

/** CLOSE / LEG OUT / Initial identity text — never green/red. */
export const SITUATION_ACTION_LINE_CLASS = "text-zinc-800 dark:text-zinc-100";

/**
 * Open/unrealized nets stay grey; realized steps use green/red by sign.
 * Credits on a still-open book are not "wins" yet.
 * Close-fill debit rows and CLOSE/LEG OUT action lines must pass `{ realized: false }`.
 */
export function pnlTone(
  net: number | null | undefined,
  opts: { realized: boolean },
): string {
  if (net == null || !Number.isFinite(net) || net === 0) return SITUATION_FILL_CASHFLOW_CLASS;
  if (!opts.realized) return SITUATION_FILL_CASHFLOW_CLASS;
  return posNegClass(net) || SITUATION_FILL_CASHFLOW_CLASS;
}
