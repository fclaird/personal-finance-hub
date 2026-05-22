export function posNegClass(v: number | null | undefined): string {
  if (typeof v !== "number" || !Number.isFinite(v) || v === 0) return "";
  return v > 0 ? "text-emerald-600 dark:text-emerald-400" : "text-red-600 dark:text-red-400";
}

export function priceDirClass(last: number | null | undefined, prevClose: number | null | undefined): string {
  if (typeof last !== "number" || !Number.isFinite(last)) return "";
  if (typeof prevClose !== "number" || !Number.isFinite(prevClose) || prevClose === 0) return "";
  const diff = last - prevClose;
  return posNegClass(diff);
}

