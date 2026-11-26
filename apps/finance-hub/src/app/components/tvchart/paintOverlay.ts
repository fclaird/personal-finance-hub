import { CLOUD_BEAR, CLOUD_BULL } from "@/lib/charts/palette";
import { distToSegment, fibPrices, hexToRgba, type Drawing, type DrawPoint } from "@/lib/charts/drawings";
import type { BandPoint, CloudPoint } from "@/lib/charts/model";
import type { ProfileBin } from "@/lib/charts/volumeProfile";
import type { ChartTime } from "@/lib/charts/types";

export type Projector = {
  x: (time: ChartTime) => number | null;
  y: (price: number) => number | null;
  width: number;
  height: number;
};

function dashOf(dash: Drawing["dash"]): number[] {
  if (dash === "dashed") return [8, 5];
  if (dash === "dotted") return [2, 3];
  return [];
}

function xy(p: Projector, point: DrawPoint): { x: number; y: number } | null {
  const x = p.x(point.time);
  const y = p.y(point.price);
  if (x == null || y == null) return null;
  return { x, y };
}

function stroke(ctx: CanvasRenderingContext2D, drawing: Pick<Drawing, "color" | "width" | "dash">) {
  ctx.strokeStyle = drawing.color;
  ctx.lineWidth = drawing.width;
  ctx.setLineDash(dashOf(drawing.dash));
  ctx.lineJoin = "round";
  ctx.lineCap = "round";
}

function rayEnd(x1: number, y1: number, x2: number, y2: number, width: number, height: number) {
  const dx = x2 - x1;
  const dy = y2 - y1;
  if (dx === 0 && dy === 0) return { x: x2, y: y2 };
  let t = Number.POSITIVE_INFINITY;
  if (dx > 0) t = Math.min(t, (width - x1) / dx);
  if (dx < 0) t = Math.min(t, (0 - x1) / dx);
  if (dy > 0) t = Math.min(t, (height - y1) / dy);
  if (dy < 0) t = Math.min(t, (0 - y1) / dy);
  if (!Number.isFinite(t) || t < 1) t = 1;
  return { x: x1 + dx * t, y: y1 + dy * t };
}

function fillQuad(
  ctx: CanvasRenderingContext2D,
  x1: number,
  y1a: number,
  y1b: number,
  x2: number,
  y2a: number,
  y2b: number,
  color: string,
) {
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x1, y1a);
  ctx.lineTo(x2, y2a);
  ctx.lineTo(x2, y2b);
  ctx.lineTo(x1, y1b);
  ctx.closePath();
  ctx.fill();
}

export function paintBands(
  ctx: CanvasRenderingContext2D,
  bands: readonly BandPoint[],
  color: string,
  p: Projector,
) {
  ctx.save();
  for (let i = 0; i < bands.length - 1; i++) {
    const a = bands[i]!;
    const b = bands[i + 1]!;
    if (b.index !== a.index + 1) continue;
    const x1 = p.x(a.time);
    const x2 = p.x(b.time);
    const y1u = p.y(a.upper);
    const y1l = p.y(a.lower);
    const y2u = p.y(b.upper);
    const y2l = p.y(b.lower);
    if (x1 == null || x2 == null || y1u == null || y1l == null || y2u == null || y2l == null) continue;
    fillQuad(ctx, x1, y1u, y1l, x2, y2u, y2l, color);
  }
  ctx.restore();
}

export function paintCloud(ctx: CanvasRenderingContext2D, cloud: readonly CloudPoint[], p: Projector) {
  ctx.save();
  for (let i = 0; i < cloud.length - 1; i++) {
    const a = cloud[i]!;
    const b = cloud[i + 1]!;
    if (b.index !== a.index + 1) continue;
    const x1 = p.x(a.time);
    const x2 = p.x(b.time);
    const y1a = p.y(a.a);
    const y1b = p.y(a.b);
    const y2a = p.y(b.a);
    const y2b = p.y(b.b);
    if (x1 == null || x2 == null || y1a == null || y1b == null || y2a == null || y2b == null) continue;
    const d1 = a.a - a.b;
    const d2 = b.a - b.b;
    const bull = d1 >= 0 ? CLOUD_BULL : CLOUD_BEAR;
    if (d1 === 0 || d2 === 0 || (d1 > 0) === (d2 > 0)) {
      fillQuad(ctx, x1, y1a, y1b, x2, y2a, y2b, bull);
      continue;
    }
    const t = d1 / (d1 - d2);
    const x = x1 + (x2 - x1) * t;
    const yA = y1a + (y2a - y1a) * t;
    const yB = y1b + (y2b - y1b) * t;
    fillQuad(ctx, x1, y1a, y1b, x, yA, yB, bull);
    fillQuad(ctx, x, yA, yB, x2, y2a, y2b, d2 >= 0 ? CLOUD_BULL : CLOUD_BEAR);
  }
  ctx.restore();
}

export function paintProfile(ctx: CanvasRenderingContext2D, bins: readonly ProfileBin[], up: string, down: string, p: Projector) {
  if (bins.length === 0) return;
  let max = 0;
  for (const bin of bins) max = Math.max(max, bin.up + bin.down);
  if (!(max > 0)) return;
  const room = Math.max(40, p.width * 0.16);
  const right = p.width - 72;
  ctx.save();
  ctx.globalAlpha = 0.85;
  for (const bin of bins) {
    const y1 = p.y(bin.high);
    const y2 = p.y(bin.low);
    if (y1 == null || y2 == null) continue;
    const top = Math.min(y1, y2);
    const height = Math.max(1, Math.abs(y2 - y1) - 1);
    const total = ((bin.up + bin.down) / max) * room;
    const upW = total * (bin.up / (bin.up + bin.down || 1));
    ctx.fillStyle = down;
    ctx.fillRect(right - total, top, total - upW, height);
    ctx.fillStyle = up;
    ctx.fillRect(right - upW, top, upW, height);
  }
  ctx.restore();
}

export function paintDrawings(
  ctx: CanvasRenderingContext2D,
  drawings: readonly Drawing[],
  selectedId: string | null,
  p: Projector,
) {
  ctx.save();
  ctx.font = "12px ui-sans-serif, system-ui, sans-serif";
  for (const drawing of drawings) {
    stroke(ctx, drawing);
    if (drawing.type === "hline") {
      const y = p.y(drawing.a.price);
      if (y == null) continue;
      ctx.beginPath();
      ctx.moveTo(0, y);
      ctx.lineTo(p.width, y);
      ctx.stroke();
      continue;
    }
    if (drawing.type === "text") {
      const at = xy(p, drawing.a);
      if (!at) continue;
      ctx.fillStyle = drawing.color;
      ctx.fillText(drawing.text, at.x, at.y);
      continue;
    }
    const a = xy(p, drawing.a);
    const b = "b" in drawing ? xy(p, drawing.b) : null;
    if (!a || !b) continue;
    if (drawing.type === "trend" || drawing.type === "measure") {
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
      if (drawing.type === "measure") {
        ctx.fillStyle = hexToRgba(drawing.color, 0.12);
        ctx.fillRect(Math.min(a.x, b.x), Math.min(a.y, b.y), Math.abs(b.x - a.x), Math.abs(b.y - a.y));
        const pct = drawing.a.price !== 0 ? ((drawing.b.price - drawing.a.price) / drawing.a.price) * 100 : 0;
        const label = `${drawing.b.price - drawing.a.price >= 0 ? "+" : ""}${(drawing.b.price - drawing.a.price).toFixed(2)} (${pct.toFixed(2)}%)`;
        ctx.fillStyle = drawing.color;
        ctx.fillText(label, Math.max(a.x, b.x) + 6, Math.min(a.y, b.y) - 6);
      }
      continue;
    }
    if (drawing.type === "ray") {
      const end = rayEnd(a.x, a.y, b.x, b.y, p.width, p.height);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(end.x, end.y);
      ctx.stroke();
      continue;
    }
    if (drawing.type === "channel") {
      const c = xy(p, drawing.c);
      if (!c) continue;
      const d = { x: c.x + (b.x - a.x), y: c.y + (b.y - a.y) };
      ctx.fillStyle = hexToRgba(drawing.color, 0.12);
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.lineTo(d.x, d.y);
      ctx.lineTo(c.x, c.y);
      ctx.closePath();
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(a.x, a.y);
      ctx.lineTo(b.x, b.y);
      ctx.moveTo(c.x, c.y);
      ctx.lineTo(d.x, d.y);
      ctx.stroke();
      continue;
    }
    if (drawing.type === "fib") {
      const left = Math.min(a.x, b.x);
      for (const level of fibPrices(drawing.a.price, drawing.b.price)) {
        const y = p.y(level.price);
        if (y == null) continue;
        ctx.beginPath();
        ctx.moveTo(left, y);
        ctx.lineTo(p.width, y);
        ctx.stroke();
        ctx.fillStyle = drawing.color;
        ctx.fillText(`${level.ratio.toFixed(3)}  ${level.price.toFixed(2)}`, left + 4, y - 3);
      }
    }
  }
  if (selectedId) {
    const selected = drawings.find((drawing) => drawing.id === selectedId);
    if (selected) {
      ctx.setLineDash([]);
      ctx.fillStyle = "#e4e4e7";
      ctx.strokeStyle = "#0a0a0a";
      ctx.lineWidth = 1;
      const anchors = anchorsOf(selected);
      for (const point of anchors) {
        const at = xy(p, point);
        if (!at) continue;
        ctx.fillRect(at.x - 4, at.y - 4, 8, 8);
        ctx.strokeRect(at.x - 4, at.y - 4, 8, 8);
      }
    }
  }
  ctx.restore();
}

function anchorsOf(drawing: Drawing): DrawPoint[] {
  if (drawing.type === "hline" || drawing.type === "text") return [drawing.a];
  if (drawing.type === "channel") return [drawing.a, drawing.b, drawing.c];
  return [drawing.a, drawing.b];
}

export type DrawingHit = { id: string; anchor: "a" | "b" | "c" | null };

export function hitTestDrawings(drawings: readonly Drawing[], x: number, y: number, p: Projector): DrawingHit | null {
  for (const drawing of drawings) {
    const points: Array<["a" | "b" | "c", DrawPoint]> =
      drawing.type === "channel"
        ? [
            ["a", drawing.a],
            ["b", drawing.b],
            ["c", drawing.c],
          ]
        : drawing.type === "hline" || drawing.type === "text"
          ? [["a", drawing.a]]
          : [
              ["a", drawing.a],
              ["b", drawing.b],
            ];
    for (const [anchor, point] of points) {
      const at = xy(p, point);
      if (at && Math.hypot(at.x - x, at.y - y) <= 8) return { id: drawing.id, anchor };
    }
  }
  for (let i = drawings.length - 1; i >= 0; i--) {
    const drawing = drawings[i]!;
    if (drawing.type === "hline") {
      const py = p.y(drawing.a.price);
      if (py != null && Math.abs(py - y) <= 6) return { id: drawing.id, anchor: null };
      continue;
    }
    if (drawing.type === "text") {
      const at = xy(p, drawing.a);
      if (at && x >= at.x && x <= at.x + drawing.text.length * 7 && Math.abs(y - at.y) <= 10) {
        return { id: drawing.id, anchor: null };
      }
      continue;
    }
    const a = xy(p, drawing.a);
    const b = "b" in drawing ? xy(p, drawing.b) : null;
    if (!a || !b) continue;
    if (drawing.type === "ray") {
      const end = rayEnd(a.x, a.y, b.x, b.y, p.width, p.height);
      if (distToSegment(x, y, a.x, a.y, end.x, end.y) <= 6) return { id: drawing.id, anchor: null };
      continue;
    }
    if (drawing.type === "fib") {
      const left = Math.min(a.x, b.x);
      for (const level of fibPrices(drawing.a.price, drawing.b.price)) {
        const py = p.y(level.price);
        if (py != null && x >= left && Math.abs(py - y) <= 5) return { id: drawing.id, anchor: null };
      }
      continue;
    }
    if (distToSegment(x, y, a.x, a.y, b.x, b.y) <= 6) return { id: drawing.id, anchor: null };
    if (drawing.type === "channel") {
      const c = xy(p, drawing.c);
      if (!c) continue;
      const d = { x: c.x + (b.x - a.x), y: c.y + (b.y - a.y) };
      if (distToSegment(x, y, c.x, c.y, d.x, d.y) <= 6) return { id: drawing.id, anchor: null };
    }
  }
  return null;
}
