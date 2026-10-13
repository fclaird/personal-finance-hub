/** A label's box in pixel space, before it is moved into a lane. */
export type LabelBox = {
  readonly id: string;
  readonly left: number;
  readonly right: number;
  readonly top: number;
  readonly bottom: number;
  /** Pixels added to the box for each lane after the first. Negative moves it up. */
  readonly shift: number;
};

export type PlacedLabel = {
  readonly id: string;
  readonly lane: number;
  readonly hidden: boolean;
};

/**
 * Put labels in lanes so their boxes never intersect.
 * The first lane is the label's own box. Later lanes shift by `shift` pixels.
 * A label that still collides after `maxLanes` is hidden.
 * Output follows the input order.
 */
export function assignLabelLanes(items: readonly LabelBox[], maxLanes = 6): PlacedLabel[] {
  const placed: { left: number; right: number; top: number; bottom: number }[] = [];
  const out = new Map<string, PlacedLabel>();
  const ordered = [...items].sort((a, b) => a.left - b.left || a.top - b.top || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  for (const item of ordered) {
    let chosen: PlacedLabel | null = null;
    for (let lane = 0; lane < maxLanes; lane++) {
      const dy = lane * item.shift;
      const box = { left: item.left, right: item.right, top: item.top + dy, bottom: item.bottom + dy };
      if (placed.some((other) => intersects(box, other))) continue;
      placed.push(box);
      chosen = { id: item.id, lane, hidden: false };
      break;
    }
    out.set(item.id, chosen ?? { id: item.id, lane: 0, hidden: true });
  }
  return items.map((item) => out.get(item.id) ?? { id: item.id, lane: 0, hidden: true });
}

export function peakReadout(name: string, deltaText: string, spot: number): string {
  return `${name}: max delta ${deltaText} at $${spot.toFixed(2)}`;
}

export function breakevenReadout(name: string, spot: number): string {
  return `${name}: breakeven at $${spot.toFixed(2)}`;
}

function intersects(
  a: { left: number; right: number; top: number; bottom: number },
  b: { left: number; right: number; top: number; bottom: number },
): boolean {
  return a.left < b.right - 0.5 && b.left < a.right - 0.5 && a.top < b.bottom - 0.5 && b.top < a.bottom - 0.5;
}
