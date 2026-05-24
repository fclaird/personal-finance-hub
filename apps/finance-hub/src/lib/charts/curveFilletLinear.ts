import type { CurveFactory } from "victory-vendor/d3-shape";

type Point = [number, number];

/** Default corner fillet radius in SVG pixels — straight segments with a tiny rounded bend. */
export const CHART_FILLET_RADIUS_PX = 4;

/**
 * Linear segments with a small quadratic fillet at each interior point (not a full spline).
 */
export function createFilletLinearCurve(radiusPx = CHART_FILLET_RADIUS_PX): CurveFactory {
  return function curveFilletLinear(context) {
    let points: Point[] = [];

    function draw() {
      const n = points.length;
      if (n === 0) return;
      if (n === 1) {
        context.moveTo(points[0]![0], points[0]![1]);
        return;
      }
      if (n === 2) {
        context.moveTo(points[0]![0], points[0]![1]);
        context.lineTo(points[1]![0], points[1]![1]);
        return;
      }

      context.moveTo(points[0]![0], points[0]![1]);

      for (let i = 1; i < n - 1; i++) {
        const [x0, y0] = points[i - 1]!;
        const [x1, y1] = points[i]!;
        const [x2, y2] = points[i + 1]!;

        const dx1 = x1 - x0;
        const dy1 = y1 - y0;
        const dx2 = x2 - x1;
        const dy2 = y2 - y1;
        const len1 = Math.hypot(dx1, dy1);
        const len2 = Math.hypot(dx2, dy2);

        if (len1 === 0 || len2 === 0) {
          context.lineTo(x1, y1);
          continue;
        }

        const trim = Math.min(radiusPx, len1 / 2, len2 / 2);
        const bx = x1 - (dx1 / len1) * trim;
        const by = y1 - (dy1 / len1) * trim;
        const ax = x1 + (dx2 / len2) * trim;
        const ay = y1 + (dy2 / len2) * trim;

        context.lineTo(bx, by);
        context.quadraticCurveTo(x1, y1, ax, ay);
      }

      const last = points[n - 1]!;
      context.lineTo(last[0], last[1]);
    }

    return {
      lineStart() {
        points = [];
      },
      lineEnd() {
        draw();
      },
      point(x: number, y: number) {
        points.push([x, y]);
      },
      areaStart() {
        /* line chart only */
      },
      areaEnd() {
        /* line chart only */
      },
    };
  };
}

/** Shared instance for performance charts. */
export const filletLinearCurve = createFilletLinearCurve();
