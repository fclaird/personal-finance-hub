import { z } from "zod";

import type { ChartTime } from "@/lib/charts/types";

export type DrawPoint = { time: ChartTime; price: number };

export type DrawDash = "solid" | "dashed" | "dotted";

export type DrawStyle = {
  color: string;
  width: 1 | 2 | 3 | 4;
  dash: DrawDash;
};

type WithStyle = DrawStyle;

export type Drawing =
  | ({ id: string; type: "trend" | "ray" | "measure"; a: DrawPoint; b: DrawPoint } & WithStyle)
  | ({ id: string; type: "hline"; a: DrawPoint } & WithStyle)
  | ({ id: string; type: "channel"; a: DrawPoint; b: DrawPoint; c: DrawPoint } & WithStyle)
  | ({ id: string; type: "fib"; a: DrawPoint; b: DrawPoint } & WithStyle)
  | ({ id: string; type: "text"; a: DrawPoint; text: string } & WithStyle);

export type DrawingDocument = {
  version: 1;
  locked: boolean;
  hidden: boolean;
  drawings: Drawing[];
};

export const FIB_RATIOS = [0, 0.236, 0.382, 0.5, 0.618, 0.786, 1] as const;

export function fibPrices(start: number, end: number): Array<{ ratio: number; price: number }> {
  return FIB_RATIOS.map((ratio) => ({ ratio, price: start + (end - start) * ratio }));
}

export function parallelEnd(a: DrawPoint, b: DrawPoint, c: DrawPoint): { dTime: number; dPrice: number } {
  const aTime = Number(a.time);
  const bTime = Number(b.time);
  const cTime = Number(c.time);
  return {
    dTime: cTime + (bTime - aTime),
    dPrice: c.price + (b.price - a.price),
  };
}

export function hexToRgba(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = Number.parseInt(h.slice(0, 2), 16);
  const g = Number.parseInt(h.slice(2, 4), 16);
  const b = Number.parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

export function distToSegment(px: number, py: number, x1: number, y1: number, x2: number, y2: number): number {
  const dx = x2 - x1;
  const dy = y2 - y1;
  const len = dx * dx + dy * dy;
  if (len === 0) return Math.hypot(px - x1, py - y1);
  let t = ((px - x1) * dx + (py - y1) * dy) / len;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (x1 + t * dx), py - (y1 + t * dy));
}

/** Snap to the OHLC price whose pixel is closest, within `maxPx`. */
export function snapToOhlc(
  price: number,
  ohlc: { open: number; high: number; low: number; close: number },
  priceToY: (value: number) => number | null,
  maxPx = 14,
): number {
  const y0 = priceToY(price);
  if (y0 == null) return price;
  let best = price;
  let bestD = maxPx;
  for (const candidate of [ohlc.open, ohlc.high, ohlc.low, ohlc.close]) {
    const y = priceToY(candidate);
    if (y == null) continue;
    const d = Math.abs(y - y0);
    if (d <= bestD) {
      bestD = d;
      best = candidate;
    }
  }
  return best;
}

const timeSchema = z.union([z.string().regex(/^\d{4}-\d{2}-\d{2}$/), z.number().int()]);
const pointSchema = z.object({ time: timeSchema, price: z.number().finite() });
const styleSchema = {
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/),
  width: z.union([z.literal(1), z.literal(2), z.literal(3), z.literal(4)]),
  dash: z.enum(["solid", "dashed", "dotted"]),
};
const idSchema = z.string().min(1).max(64);

const drawingSchema = z.discriminatedUnion("type", [
  z.object({ id: idSchema, type: z.enum(["trend", "ray", "measure"]), a: pointSchema, b: pointSchema, ...styleSchema }),
  z.object({ id: idSchema, type: z.literal("hline"), a: pointSchema, ...styleSchema }),
  z.object({ id: idSchema, type: z.literal("channel"), a: pointSchema, b: pointSchema, c: pointSchema, ...styleSchema }),
  z.object({ id: idSchema, type: z.literal("fib"), a: pointSchema, b: pointSchema, ...styleSchema }),
  z.object({
    id: idSchema,
    type: z.literal("text"),
    a: pointSchema,
    text: z.string().min(1).max(200),
    ...styleSchema,
  }),
]);

const documentSchema = z.object({
  version: z.literal(1),
  locked: z.boolean(),
  hidden: z.boolean(),
  drawings: z.array(drawingSchema).max(200),
});

export function emptyDrawingDocument(): DrawingDocument {
  return { version: 1, locked: false, hidden: false, drawings: [] };
}

export function parseDrawingDocument(raw: unknown): DrawingDocument | null {
  const parsed = documentSchema.safeParse(raw);
  return parsed.success ? parsed.data : null;
}

export const DEFAULT_DRAW_STYLE: DrawStyle = { color: "#E4E4E7", width: 2, dash: "solid" };
