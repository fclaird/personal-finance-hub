/**
 * Shown names when two structures share a label. The first keeps the label.
 * Later copies read "ZEBRA (2)", "ZEBRA (3)", in board order. The stored label
 * stays what was typed, so a rename still edits the original text.
 */
export function structureDisplayNames(
  rows: readonly { readonly id: string; readonly label: string }[],
): ReadonlyMap<string, string> {
  const totals = new Map<string, number>();
  for (const row of rows) {
    const label = shownLabel(row.label);
    totals.set(label, (totals.get(label) ?? 0) + 1);
  }
  const seen = new Map<string, number>();
  const names = new Map<string, string>();
  for (const row of rows) {
    const label = shownLabel(row.label);
    const n = (seen.get(label) ?? 0) + 1;
    seen.set(label, n);
    names.set(row.id, (totals.get(label) ?? 0) > 1 && n > 1 ? `${label} (${n})` : label);
  }
  return names;
}

export function structureDisplayName(
  rows: readonly { readonly id: string; readonly label: string }[],
  id: string,
  fallback = "Structure",
): string {
  return structureDisplayNames(rows).get(id) ?? fallback;
}

/** Tooltip and legend rows. dataKey is structure id plus horizon, not the display name. */
export function seriesReactKey(item: { readonly dataKey?: unknown }, index: number): string {
  const raw = item.dataKey;
  const id = typeof raw === "string" || typeof raw === "number" ? String(raw) : "series";
  return `${id}:${index}`;
}

function shownLabel(label: string): string {
  const trimmed = label.trim();
  return trimmed.length > 0 ? trimmed : "Structure";
}
