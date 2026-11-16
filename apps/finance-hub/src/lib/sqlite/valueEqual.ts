/** True when two stored numbers would dirty a page if written again. */
export function numbersDiffer(prev: number | null | undefined, next: number | null | undefined): boolean {
  if (prev == null || next == null) return prev !== next;
  if (!Number.isFinite(prev) || !Number.isFinite(next)) return true;
  const scale = Math.max(1, Math.abs(prev), Math.abs(next));
  return Math.abs(prev - next) > scale * 1e-9;
}
