"use client";

import { useEffect, useRef, useState } from "react";

import { snapToOhlc, type Drawing, type DrawPoint, type DrawStyle } from "@/lib/charts/drawings";
import type { ChartModel } from "@/lib/charts/model";
import { snapExpiryTime } from "@/lib/charts/model";
import { CALL_STRIKE, CANDLE_DOWN, CANDLE_UP, CHART_BG, CHART_BORDER, CHART_GRID, CHART_TEXT, EXPIRY_MARK, PUT_STRIKE } from "@/lib/charts/palette";
import type { ChartTool } from "@/lib/charts/tools";
import type { BookOverlay } from "@/lib/charts/bookOverlay";
import type { ProfileBin } from "@/lib/charts/volumeProfile";
import type { ChartTime } from "@/lib/charts/types";
import { hitTestDrawings, paintBands, paintCloud, paintDrawings, paintProfile, type Projector } from "@/app/components/tvchart/paintOverlay";

type StageProps = {
  model: ChartModel;
  tool: ChartTool;
  magnet: boolean;
  locked: boolean;
  drawingsHidden: boolean;
  drawings: Drawing[];
  pen: DrawStyle;
  book: BookOverlay | null;
  bookVisible: boolean;
  profile: ProfileBin[] | null;
  profileVisible: boolean;
  profileUp: string;
  profileDown: string;
  settingsVisible: {
    ma: boolean[];
    ichimoku: boolean;
    bb: boolean;
    bmsb: boolean;
    vwap: boolean;
    volume: boolean;
  };
  colors: {
    ma: string[];
    maWidth: Array<1 | 2 | 3 | 4>;
    conversion: string;
    base: string;
    spanA: string;
    spanB: string;
    lagging: string;
    ichimokuWidth: 1 | 2 | 3 | 4;
    bb: string;
    bbWidth: 1 | 2 | 3 | 4;
    bmsbSma: string;
    bmsbEma: string;
    bmsbWidth: 1 | 2 | 3 | 4;
    vwap: string;
    vwapWidth: 1 | 2 | 3 | 4;
  };
  onHover: (index: number | null) => void;
  onDrawingsChange: (next: Drawing[]) => void;
  onSelect: (id: string | null) => void;
};

type Draft =
  | { kind: "trend" | "ray" | "fib" | "measure"; a: DrawPoint; cursor: DrawPoint | null }
  | { kind: "channel"; a: DrawPoint; b: DrawPoint | null; cursor: DrawPoint | null };

function timeKey(time: unknown): string {
  if (typeof time === "string" || typeof time === "number") return String(time);
  if (time && typeof time === "object" && "year" in time && "month" in time && "day" in time) {
    const row = time as { year: number; month: number; day: number };
    return `${row.year}-${String(row.month).padStart(2, "0")}-${String(row.day).padStart(2, "0")}`;
  }
  return "";
}

export function ChartStage(props: StageProps) {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const bagRef = useRef<ChartBag | null>(null);
  const propsRef = useRef(props);
  const paintRef = useRef<() => void>(() => {});
  const draftRef = useRef<Draft | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [textAt, setTextAt] = useState<{ point: DrawPoint; x: number; y: number } | null>(null);
  const [textValue, setTextValue] = useState("");
  const [ready, setReady] = useState(0);
  propsRef.current = props;
  draftRef.current = draft;

  const onSelect = props.onSelect;
  useEffect(() => {
    onSelect(selectedId);
  }, [selectedId, onSelect]);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let disposed = false;
    let detach = () => {};
    void import("lightweight-charts").then((lwc) => {
      if (disposed || !hostRef.current) return;
      const chart = lwc.createChart(hostRef.current, {
        autoSize: true,
        layout: { background: { type: lwc.ColorType.Solid, color: CHART_BG }, textColor: CHART_TEXT, fontSize: 12 },
        grid: { vertLines: { color: CHART_GRID }, horzLines: { color: CHART_GRID } },
        crosshair: { mode: lwc.CrosshairMode.Normal },
        rightPriceScale: { borderColor: CHART_BORDER },
        timeScale: { borderColor: CHART_BORDER, timeVisible: typeof propsRef.current.model.candles[0]?.time === "number", secondsVisible: false, rightOffset: 6 },
      });
      const line = (color: string, width: 1 | 2 | 3 | 4) =>
        chart.addSeries(lwc.LineSeries, {
          color,
          lineWidth: width,
          priceLineVisible: false,
          lastValueVisible: true,
          crosshairMarkerVisible: false,
        });
      const candles = chart.addSeries(lwc.CandlestickSeries, {
        upColor: CANDLE_UP,
        downColor: CANDLE_DOWN,
        borderUpColor: CANDLE_UP,
        borderDownColor: CANDLE_DOWN,
        wickUpColor: CANDLE_UP,
        wickDownColor: CANDLE_DOWN,
        priceLineVisible: true,
      });
      const volume = chart.addSeries(lwc.HistogramSeries, {
        priceFormat: { type: "volume" },
        priceScaleId: "volume",
        priceLineVisible: false,
        lastValueVisible: false,
      });
      const bag: ChartBag = {
        lwc,
        chart,
        candles,
        volume,
        ma: [0, 1, 2, 3].map(() => line("#ffffff", 2)),
        conversion: line("#2962FF", 2),
        base: line("#E53935", 2),
        spanA: line("#A5D6A7", 2),
        spanB: line("#EF9A9A", 2),
        lagging: line("#9CCC65", 2),
        bbMid: line("#FFC107", 2),
        bbUp: line("#FFC107", 2),
        bbLo: line("#FFC107", 2),
        bmsbSma: line("#FFB300", 2),
        bmsbEma: line("#00E676", 2),
        vwap: line("#FFEB3B", 2),
        markers: lwc.createSeriesMarkers(candles, []),
        priceLines: [],
        fitted: false,
      };
      bagRef.current = bag;
      setReady((n) => n + 1);
      const onCross = (param: { logical?: number }) => {
        propsRef.current.onHover(param.logical == null ? null : Math.round(param.logical));
        paintRef.current();
      };
      chart.subscribeCrosshairMove(onCross);
      const onRange = () => paintRef.current();
      chart.timeScale().subscribeVisibleLogicalRangeChange(onRange);
      paintRef.current();
      detach = () => {
        chart.unsubscribeCrosshairMove(onCross);
        chart.timeScale().unsubscribeVisibleLogicalRangeChange(onRange);
        chart.remove();
        bagRef.current = null;
      };
    });
    return () => {
      disposed = true;
      detach();
    };
  }, []);

  useEffect(() => {
    const bag = bagRef.current;
    if (!bag) return;
    const { model, colors, settingsVisible } = props;
    bag.candles.setData(model.candleData as never);
    bag.volume.setData(model.volume as never);
    bag.volume.applyOptions({ visible: settingsVisible.volume });
    model.mas.forEach((series, i) => {
      bag.ma[i]!.setData(series as never);
      bag.ma[i]!.applyOptions({
        color: colors.ma[i] ?? "#ffffff",
        lineWidth: colors.maWidth[i] ?? 2,
        visible: settingsVisible.ma[i] !== false,
        lastValueVisible: settingsVisible.ma[i] !== false,
      });
    });
    const ich = settingsVisible.ichimoku;
    applyLine(bag.conversion, model.conversion, colors.conversion, colors.ichimokuWidth, ich);
    applyLine(bag.base, model.base, colors.base, colors.ichimokuWidth, ich);
    applyLine(bag.spanA, model.spanA, colors.spanA, colors.ichimokuWidth, ich);
    applyLine(bag.spanB, model.spanB, colors.spanB, colors.ichimokuWidth, ich);
    applyLine(bag.lagging, model.lagging, colors.lagging, colors.ichimokuWidth, ich);
    applyLine(bag.bbMid, model.bbMid, colors.bb, colors.bbWidth, settingsVisible.bb);
    applyLine(bag.bbUp, model.bbUp, colors.bb, colors.bbWidth, settingsVisible.bb);
    applyLine(bag.bbLo, model.bbLo, colors.bb, colors.bbWidth, settingsVisible.bb);
    applyLine(bag.bmsbSma, model.bmsbSma, colors.bmsbSma, colors.bmsbWidth, settingsVisible.bmsb);
    applyLine(bag.bmsbEma, model.bmsbEma, colors.bmsbEma, colors.bmsbWidth, settingsVisible.bmsb);
    applyLine(bag.vwap, model.vwap, colors.vwap, colors.vwapWidth, settingsVisible.vwap);
    bag.chart.priceScale("right").applyOptions({ scaleMargins: { top: 0.08, bottom: settingsVisible.volume ? 0.22 : 0.08 } });
    bag.chart.priceScale("volume").applyOptions({ scaleMargins: { top: 0.8, bottom: 0 } });
    for (const line of bag.priceLines) bag.candles.removePriceLine(line);
    bag.priceLines = [];
    if (props.bookVisible && props.book) {
      for (const strike of props.book.strikes) {
        const both = strike.rights.includes("C") && strike.rights.includes("P");
        bag.priceLines.push(
          bag.candles.createPriceLine({
            price: strike.strike,
            color: both ? CHART_TEXT : strike.rights.includes("C") ? CALL_STRIKE : PUT_STRIKE,
            lineWidth: 1,
            lineStyle: bag.lwc.LineStyle.Dashed,
            axisLabelVisible: true,
            title: `${strike.rights.join("+")} ${strike.strike}`,
          }),
        );
      }
      const seen = new Set<string>();
      const markers = [];
      for (const expiry of props.book.expiries) {
        const time = snapExpiryTime(model.times, expiry);
        if (time == null || seen.has(String(time))) continue;
        seen.add(String(time));
        markers.push({
          time,
          position: "aboveBar" as const,
          color: EXPIRY_MARK,
          shape: "arrowDown" as const,
          text: expiry.slice(5),
        });
      }
      bag.markers.setMarkers(markers as never);
    } else {
      bag.markers.setMarkers([]);
    }
    if (!bag.fitted && model.candles.length > 1) {
      const n = model.candles.length;
      bag.chart.timeScale().setVisibleLogicalRange({ from: Math.max(0, n - 180), to: n + 8 });
      bag.fitted = true;
    }
    paintRef.current();
  }, [ready, props.model, props.colors, props.settingsVisible, props.book, props.bookVisible]);

  paintRef.current = () => {
    const canvas = canvasRef.current;
    const host = hostRef.current;
    const bag = bagRef.current;
    if (!canvas || !host || !bag) return;
    const width = host.clientWidth;
    const height = host.clientHeight;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = Math.max(1, Math.floor(width * dpr));
    canvas.height = Math.max(1, Math.floor(height * dpr));
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);
    const current = propsRef.current;
    const p: Projector = {
      width,
      height,
      x: (time) => bag.chart.timeScale().timeToCoordinate(time as never),
      y: (price) => bag.candles.priceToCoordinate(price),
    };
    if (current.settingsVisible.bmsb) paintBands(ctx, current.model.bmsbFill, "rgba(0, 230, 118, 0.16)", p);
    if (current.settingsVisible.bb) paintBands(ctx, current.model.bbFill, "rgba(255, 193, 7, 0.14)", p);
    if (current.settingsVisible.ichimoku) paintCloud(ctx, current.model.cloud, p);
    if (current.profileVisible && current.profile) paintProfile(ctx, current.profile, current.profileUp, current.profileDown, p);
    const drawings = current.drawingsHidden ? [] : current.drawings;
    const pending = draftRef.current;
    const preview = pending && pending.kind === current.tool ? previewDrawing(pending, current.pen) : null;
    paintDrawings(ctx, preview ? drawings.concat(preview) : drawings, selectedId, p);
  };

  function projector(): Projector | null {
    const bag = bagRef.current;
    const host = hostRef.current;
    if (!bag || !host) return null;
    return {
      width: host.clientWidth,
      height: host.clientHeight,
      x: (time) => bag.chart.timeScale().timeToCoordinate(time as never),
      y: (price) => bag.candles.priceToCoordinate(price),
    };
  }

  function pointAt(x: number, y: number): DrawPoint | null {
    const bag = bagRef.current;
    const current = propsRef.current;
    if (!bag) return null;
    const rawTime = bag.chart.timeScale().coordinateToTime(x);
    const price = bag.candles.coordinateToPrice(y);
    if (rawTime == null || price == null) return null;
    const key = timeKey(rawTime);
    let best: ChartTime | null = null;
    let bestD = Infinity;
    for (const time of current.model.times) {
      const d = typeof time === "number" ? Math.abs(time - Number(key)) : Math.abs(Date.parse(String(time)) - Date.parse(key));
      if (d < bestD) {
        bestD = d;
        best = time;
      }
    }
    if (best == null) best = typeof rawTime === "number" ? rawTime : key;
    let next = Number(price);
    if (current.magnet) {
      const bar = current.model.candles.find((item) => item.time === best) ?? nearestBar(current.model, best);
      if (bar) next = snapToOhlc(next, bar, (value) => bag.candles.priceToCoordinate(value));
    }
    return { time: best, price: next };
  }

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;
    let drag: { id: string; anchor: "a" | "b" | "c" | "body"; start: DrawPoint; orig: Drawing } | null = null;
    let arm: { x: number; y: number } | null = null;

    function local(event: PointerEvent) {
      const rect = host!.getBoundingClientRect();
      return { x: event.clientX - rect.left, y: event.clientY - rect.top };
    }

    function onDown(event: PointerEvent) {
      if (event.button !== 0) return;
      const current = propsRef.current;
      const pos = local(event);
      const p = projector();
      const hit = p && !current.drawingsHidden ? hitTestDrawings(current.drawings, pos.x, pos.y, p) : null;
      if (current.tool === "delete" && hit && !current.locked) {
        event.preventDefault();
        event.stopPropagation();
        current.onDrawingsChange(current.drawings.filter((drawing) => drawing.id !== hit.id));
        setSelectedId(null);
        return;
      }
      if ((current.tool === "crosshair" || current.tool === "delete") && hit?.anchor && !current.locked) {
        const orig = current.drawings.find((drawing) => drawing.id === hit.id);
        if (!orig) return;
        event.preventDefault();
        event.stopPropagation();
        const start = pointAt(pos.x, pos.y);
        if (!start) return;
        drag = { id: hit.id, anchor: hit.anchor, start, orig };
        setSelectedId(hit.id);
        return;
      }
      if (current.tool === "crosshair" || current.tool === "delete") {
        arm = pos;
        return;
      }
      if (current.locked) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      event.preventDefault();
      event.stopPropagation();
      const point = pointAt(pos.x, pos.y);
      if (!point) return;
      place(point, pos);
    }

    function onMove(event: PointerEvent) {
      const pos = local(event);
      if (drag) {
        const point = pointAt(pos.x, pos.y);
        if (!point) return;
        const current = propsRef.current;
        const moved = moveDrawing(drag.orig, drag.anchor, drag.start, point, current.model.times);
        current.onDrawingsChange(current.drawings.map((drawing) => (drawing.id === drag!.id ? moved : drawing)));
        return;
      }
      const pending = draftRef.current;
      if (!pending) return;
      const point = pointAt(pos.x, pos.y);
      setDraft({ ...pending, cursor: point });
    }

    function onUp(event: PointerEvent) {
      if (drag) {
        drag = null;
        return;
      }
      if (!arm) return;
      const pos = local(event);
      const moved = Math.hypot(pos.x - arm.x, pos.y - arm.y);
      arm = null;
      if (moved > 5) return;
      const p = projector();
      const current = propsRef.current;
      const hit = p && !current.drawingsHidden ? hitTestDrawings(current.drawings, pos.x, pos.y, p) : null;
      setSelectedId(hit?.id ?? null);
    }

    host.addEventListener("pointerdown", onDown, true);
    window.addEventListener("pointermove", onMove);
    window.addEventListener("pointerup", onUp);
    return () => {
      host.removeEventListener("pointerdown", onDown, true);
      window.removeEventListener("pointermove", onMove);
      window.removeEventListener("pointerup", onUp);
    };
  }, []);

  function place(point: DrawPoint, pos: { x: number; y: number }) {
    const current = propsRef.current;
    const pending = draftRef.current;
    const style = current.pen;
    if (current.tool === "hline") {
      commit({ id: crypto.randomUUID(), type: "hline", a: point, ...style });
      return;
    }
    if (current.tool === "text") {
      setTextAt({ point, x: pos.x, y: pos.y });
      setTextValue("");
      return;
    }
    if (current.tool === "channel") {
      if (!pending || pending.kind !== "channel") {
        setDraft({ kind: "channel", a: point, b: null, cursor: null });
        return;
      }
      if (!pending.b) {
        setDraft({ kind: "channel", a: pending.a, b: point, cursor: null });
        return;
      }
      commit({ id: crypto.randomUUID(), type: "channel", a: pending.a, b: pending.b, c: point, ...style });
      setDraft(null);
      return;
    }
    if (current.tool === "trend" || current.tool === "ray" || current.tool === "fib" || current.tool === "measure") {
      if (!pending || pending.kind !== current.tool) {
        setDraft({ kind: current.tool, a: point, cursor: null });
        return;
      }
      commit({ id: crypto.randomUUID(), type: current.tool, a: pending.a, b: point, ...style });
      setDraft(null);
    }
  }

  function commit(drawing: Drawing) {
    const current = propsRef.current;
    current.onDrawingsChange(current.drawings.concat(drawing));
    setSelectedId(drawing.id);
    paintRef.current();
  }

  useEffect(() => {
    paintRef.current();
  }, [draft, selectedId, props.drawings, props.drawingsHidden, props.model, props.profile, props.profileVisible]);

  return (
    <div ref={hostRef} className="absolute inset-0" data-chart-stage>
      <canvas ref={canvasRef} className="pointer-events-none absolute inset-0 z-10" />
      {textAt ? (
        <form
          className="absolute z-20"
          style={{ left: textAt.x, top: textAt.y }}
          onSubmit={(event) => {
            event.preventDefault();
            const text = textValue.trim();
            if (text) commit({ id: crypto.randomUUID(), type: "text", a: textAt.point, text, ...props.pen });
            setTextAt(null);
          }}
        >
          <input
            autoFocus
            value={textValue}
            onChange={(event) => setTextValue(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") setTextAt(null);
            }}
            placeholder="Label"
            className="h-8 w-40 rounded border border-zinc-400 bg-zinc-900 px-2 text-sm text-zinc-100"
            style={{ colorScheme: "dark" }}
          />
        </form>
      ) : null}
    </div>
  );
}

type LineSeries = {
  setData: (data: never) => void;
  applyOptions: (options: { color?: string; lineWidth?: 1 | 2 | 3 | 4; visible?: boolean; lastValueVisible?: boolean }) => void;
};

function applyLine(series: LineSeries, data: Array<{ time: ChartTime; value: number }>, color: string, width: 1 | 2 | 3 | 4, visible: boolean) {
  series.setData(data as never);
  series.applyOptions({ color, lineWidth: width, visible, lastValueVisible: visible });
}

type ChartBag = {
  lwc: typeof import("lightweight-charts");
  chart: import("lightweight-charts").IChartApi;
  candles: import("lightweight-charts").ISeriesApi<"Candlestick">;
  volume: import("lightweight-charts").ISeriesApi<"Histogram">;
  ma: Array<import("lightweight-charts").ISeriesApi<"Line">>;
  conversion: import("lightweight-charts").ISeriesApi<"Line">;
  base: import("lightweight-charts").ISeriesApi<"Line">;
  spanA: import("lightweight-charts").ISeriesApi<"Line">;
  spanB: import("lightweight-charts").ISeriesApi<"Line">;
  lagging: import("lightweight-charts").ISeriesApi<"Line">;
  bbMid: import("lightweight-charts").ISeriesApi<"Line">;
  bbUp: import("lightweight-charts").ISeriesApi<"Line">;
  bbLo: import("lightweight-charts").ISeriesApi<"Line">;
  bmsbSma: import("lightweight-charts").ISeriesApi<"Line">;
  bmsbEma: import("lightweight-charts").ISeriesApi<"Line">;
  vwap: import("lightweight-charts").ISeriesApi<"Line">;
  markers: import("lightweight-charts").ISeriesMarkersPluginApi<import("lightweight-charts").Time>;
  priceLines: import("lightweight-charts").IPriceLine[];
  fitted: boolean;
};

function nearestBar(model: ChartModel, time: ChartTime) {
  return model.candles.find((bar) => bar.time === time) ?? null;
}

function previewDrawing(draft: Draft | null, pen: DrawStyle): Drawing | null {
  if (!draft || !draft.cursor) return null;
  if (draft.kind === "channel") {
    if (!draft.b) return { id: "preview", type: "trend", a: draft.a, b: draft.cursor, ...pen };
    return { id: "preview", type: "channel", a: draft.a, b: draft.b, c: draft.cursor, ...pen };
  }
  return { id: "preview", type: draft.kind, a: draft.a, b: draft.cursor, ...pen };
}

function moveDrawing(orig: Drawing, anchor: "a" | "b" | "c" | "body", start: DrawPoint, point: DrawPoint, times: readonly ChartTime[]): Drawing {
  if (anchor !== "body") {
    if (anchor === "a") return { ...orig, a: point };
    if (anchor === "b" && "b" in orig) return { ...orig, b: point };
    if (anchor === "c" && orig.type === "channel") return { ...orig, c: point };
    return orig;
  }
  const dPrice = point.price - start.price;
  const from = times.findIndex((time) => time === start.time);
  const to = times.findIndex((time) => time === point.time);
  const shift = from >= 0 && to >= 0 ? to - from : 0;
  const moved = (source: DrawPoint): DrawPoint => {
    const index = times.findIndex((time) => time === source.time);
    const next = index >= 0 ? times[Math.max(0, Math.min(times.length - 1, index + shift))]! : source.time;
    return { time: next, price: source.price + dPrice };
  };
  if (orig.type === "hline" || orig.type === "text") return { ...orig, a: moved(orig.a) };
  if (orig.type === "channel") return { ...orig, a: moved(orig.a), b: moved(orig.b), c: moved(orig.c) };
  return { ...orig, a: moved(orig.a), b: moved(orig.b) };
}
