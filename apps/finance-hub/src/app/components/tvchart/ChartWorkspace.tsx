"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useRouter } from "next/navigation";

import { ChartLegend } from "@/app/components/tvchart/ChartLegend";
import { ChartStage } from "@/app/components/tvchart/ChartStage";
import { ChartToolbar } from "@/app/components/tvchart/ChartToolbar";
import { latestSessionBars, regularSessionKey } from "@/lib/charts/bars";
import type { BookOverlay } from "@/lib/charts/bookOverlay";
import { DEFAULT_DRAW_STYLE, type DrawingDocument, type DrawStyle } from "@/lib/charts/drawings";
import { emptyDrawingDocument, parseDrawingDocument } from "@/lib/charts/drawings";
import { formatChange, formatPx, sessionBadge } from "@/lib/charts/format";
import { DEFAULT_INDICATORS, sanitizeIndicatorSettings, type IndicatorSettings } from "@/lib/charts/indicatorSettings";
import { buildChartModel } from "@/lib/charts/model";
import { sessionVwap } from "@/lib/charts/indicators";
import type { ChartTool } from "@/lib/charts/tools";
import type { ChartCandle, ChartInterval, ChartQuoteMeta } from "@/lib/charts/types";
import { isIntradayInterval } from "@/lib/charts/bars";
import { volumeProfile } from "@/lib/charts/volumeProfile";
import { CANDLE_DOWN, CANDLE_UP } from "@/lib/charts/palette";

const SETTINGS_KEY = "fh.chart.indicators.v1";
const RECENT_KEY = "fh.chart.recent.v1";

const INTERVALS: Array<{ id: ChartInterval; label: string; title: string }> = [
  { id: "5m", label: "5m", title: "5 minute (Alt+6)" },
  { id: "15m", label: "15m", title: "15 minute (Alt+5)" },
  { id: "60m", label: "1H", title: "1 hour (Alt+4)" },
  { id: "1d", label: "D", title: "Daily (D)" },
  { id: "1wk", label: "W", title: "Weekly (W)" },
  { id: "1mo", label: "M", title: "Monthly (M)" },
];

type CandleResponse = {
  ok: boolean;
  error?: string;
  candles?: ChartCandle[];
  meta?: ChartQuoteMeta;
  fromCache?: boolean;
};

export function ChartWorkspace({ ticker }: { ticker: string }) {
  const router = useRouter();
  const symbol = ticker.trim().toUpperCase();
  const searchRef = useRef<HTMLInputElement | null>(null);
  const [query, setQuery] = useState(symbol);
  const [interval, setInterval] = useState<ChartInterval>("1d");
  const [candles, setCandles] = useState<ChartCandle[]>([]);
  const [meta, setMeta] = useState<ChartQuoteMeta | null>(null);
  const [fromCache, setFromCache] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [intraday, setIntraday] = useState<ChartCandle[] | null>(null);
  const [intradayError, setIntradayError] = useState(false);
  const [settings, setSettings] = useState<IndicatorSettings>(DEFAULT_INDICATORS);
  const [document, setDocument] = useState<DrawingDocument>(emptyDrawingDocument());
  const [pen, setPen] = useState<DrawStyle>(DEFAULT_DRAW_STYLE);
  const [tool, setTool] = useState<ChartTool>("crosshair");
  const [magnet, setMagnet] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [hover, setHover] = useState<number | null>(null);
  const [gear, setGear] = useState<"ma0" | "ma1" | "ma2" | "ma3" | "ichimoku" | "bb" | "bmsb" | "vwap" | "volume" | "profile" | null>(null);
  const [book, setBook] = useState<BookOverlay | null>(null);
  const [recent, setRecent] = useState<string[]>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const documentRef = useRef(document);
  const [settingsReady, setSettingsReady] = useState(false);
  useEffect(() => {
    documentRef.current = document;
  }, [document]);

  useEffect(() => {
    try {
      const raw = localStorage.getItem(SETTINGS_KEY);
      if (raw) setSettings(sanitizeIndicatorSettings(JSON.parse(raw)));
      const savedRecent = localStorage.getItem(RECENT_KEY);
      if (savedRecent) setRecent(JSON.parse(savedRecent) as string[]);
      setMagnet(localStorage.getItem("fh.chart.magnet") === "1");
    } catch {
      /* ignore broken local settings */
    }
    setSettingsReady(true);
  }, []);

  useEffect(() => {
    if (!settingsReady) return;
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  }, [settings, settingsReady]);

  useEffect(() => {
    if (!symbol) return;
    setQuery(symbol);
    setRecent((prev) => {
      const next = [symbol, ...prev.filter((item) => item !== symbol)].slice(0, 8);
      if (settingsReady) localStorage.setItem(RECENT_KEY, JSON.stringify(next));
      return next;
    });
  }, [symbol, settingsReady]);

  useEffect(() => {
    if (!symbol) return;
    let cancel = false;
    setLoading(true);
    setError(null);
    void fetch(`/api/charts/candles?symbol=${encodeURIComponent(symbol)}&interval=${interval}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<CandleResponse>)
      .then((body) => {
        if (cancel) return;
        if (!body.ok || !body.candles) {
          setCandles([]);
          setError(body.error ?? "No candles");
          return;
        }
        setCandles(body.candles);
        setMeta(body.meta ?? null);
        setFromCache(Boolean(body.fromCache));
      })
      .catch((reason: unknown) => {
        if (!cancel) setError(reason instanceof Error ? reason.message : String(reason));
      })
      .finally(() => {
        if (!cancel) setLoading(false);
      });
    return () => {
      cancel = true;
    };
  }, [symbol, interval]);

  useEffect(() => {
    if (!symbol) return;
    let cancel = false;
    if (saveTimer.current) clearTimeout(saveTimer.current);
    void fetch(`/api/charts/drawings?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<{ ok: boolean; document?: unknown }>)
      .then((body) => {
        if (cancel) return;
        setDocument(parseDrawingDocument(body.document) ?? emptyDrawingDocument());
      })
      .catch(() => {
        if (!cancel) setDocument(emptyDrawingDocument());
      });
    void fetch(`/api/charts/overlay?symbol=${encodeURIComponent(symbol)}`, { cache: "no-store" })
      .then((response) => response.json() as Promise<BookOverlay & { ok: boolean }>)
      .then((body) => {
        if (!cancel && body.ok) setBook({ symbol: body.symbol, strikes: body.strikes ?? [], expiries: body.expiries ?? [] });
      })
      .catch(() => {
        if (!cancel) setBook(null);
      });
    return () => {
      cancel = true;
    };
  }, [symbol]);

  const needsIntraday = (settings.vwap.visible || settings.profile.visible) && !isIntradayInterval(interval);
  useEffect(() => {
    if (!symbol || !needsIntraday) return;
    let cancel = false;
    void fetch(`/api/charts/candles?symbol=${encodeURIComponent(symbol)}&interval=5m`, { cache: "no-store" })
      .then((response) => response.json() as Promise<CandleResponse>)
      .then((body) => {
        if (cancel) return;
        setIntradayError(!body.ok || !body.candles?.length);
        setIntraday(body.candles ?? []);
      })
      .catch(() => {
        if (!cancel) setIntradayError(true);
      });
    return () => {
      cancel = true;
    };
  }, [symbol, needsIntraday]);

  const expiryUntil = book && settings.book.visible ? (book.expiries[book.expiries.length - 1] ?? null) : null;
  const model = useMemo(
    () => buildChartModel(candles, interval, settings, expiryUntil),
    [candles, interval, settings, expiryUntil],
  );
  const legend = model.valuesAt(hover);
  const headerBar = legend.bar ?? model.valuesAt(null).bar;
  const headerChange = headerBar ? model.valuesAt(hover != null && legend.bar ? hover : null) : legend;
  const badge = sessionBadge(meta);

  const sessionBars = useMemo(() => {
    const source = isIntradayInterval(interval) ? candles : (intraday ?? []);
    return latestSessionBars(source.filter((bar): bar is ChartCandle & { time: number } => typeof bar.time === "number"));
  }, [candles, intraday, interval]);
  const profile = useMemo(
    () => (settings.profile.visible ? volumeProfile(sessionBars, settings.profile.bins) : null),
    [sessionBars, settings.profile.visible, settings.profile.bins],
  );
  const sessionVwapValue = useMemo(() => {
    if (!sessionBars.length) return null;
    const series = sessionVwap(
      sessionBars.map((bar) => ({
        high: bar.high,
        low: bar.low,
        close: bar.close,
        volume: bar.volume,
        session: regularSessionKey(bar.time),
      })),
    );
    for (let i = series.length - 1; i >= 0; i--) {
      if (series[i] != null) return series[i]!;
    }
    return null;
  }, [sessionBars]);

  const updateDocument = useCallback((next: DrawingDocument) => {
    setDocument(next);
    if (saveTimer.current) clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      void fetch("/api/charts/drawings", {
        method: "PUT",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ symbol, document: next }),
      });
    }, 400);
  }, [symbol]);

  const onSelect = useCallback((id: string | null) => setSelectedId(id), []);

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target;
      if (target instanceof HTMLElement) {
        const tag = target.tagName;
        if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || target.isContentEditable) return;
      }
      if (event.key === "/") {
        event.preventDefault();
        searchRef.current?.focus();
        return;
      }
      if (event.key === "Escape") {
        setTool("crosshair");
        return;
      }
      const current = documentRef.current;
      if ((event.key === "Delete" || event.key === "Backspace") && selectedId && !current.locked) {
        event.preventDefault();
        updateDocument({ ...current, drawings: current.drawings.filter((drawing) => drawing.id !== selectedId) });
        setSelectedId(null);
        return;
      }
      if (event.altKey && !event.metaKey && !event.ctrlKey) {
        const shortcuts: Record<string, string> = {
          t: "trend",
          r: "ray",
          h: "hline",
          p: "channel",
          f: "fib",
          x: "text",
          m: "measure",
          g: "magnet",
          l: "lock",
          v: "hide",
          "4": "60m",
          "5": "15m",
          "6": "5m",
        };
        const hit = shortcuts[event.key.toLowerCase()];
        if (!hit) return;
        event.preventDefault();
        if (hit === "magnet") setMagnet((value) => !value);
        else if (hit === "lock") updateDocument({ ...documentRef.current, locked: !documentRef.current.locked });
        else if (hit === "hide") updateDocument({ ...documentRef.current, hidden: !documentRef.current.hidden });
        else if (hit === "60m" || hit === "15m" || hit === "5m") setInterval(hit);
        else setTool(hit as ChartTool);
        return;
      }
      if (event.metaKey || event.ctrlKey || event.altKey) return;
      if (event.key === "d" || event.key === "D") setInterval("1d");
      if (event.key === "w" || event.key === "W") setInterval("1wk");
      if (event.key === "m" || event.key === "M") setInterval("1mo");
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedId, updateDocument]);

  useEffect(() => {
    localStorage.setItem("fh.chart.magnet", magnet ? "1" : "0");
  }, [magnet]);

  function onPen(patch: Partial<DrawStyle>) {
    if (selectedId) {
      updateDocument({
        ...document,
        drawings: document.drawings.map((drawing) => (drawing.id === selectedId ? { ...drawing, ...patch } : drawing)),
      });
      return;
    }
    setPen((prev) => ({ ...prev, ...patch }));
  }

  const activePen = selectedId ? (document.drawings.find((drawing) => drawing.id === selectedId) ?? pen) : pen;
  const stageVisible = useMemo(
    () => ({
      ma: settings.ma.map((row) => row.visible),
      ichimoku: settings.ichimoku.visible,
      bb: settings.bb.visible,
      bmsb: settings.bmsb.visible,
      vwap: settings.vwap.visible && isIntradayInterval(interval),
      volume: settings.volume.visible,
    }),
    [settings, interval],
  );
  const stageColors = useMemo(
    () => ({
      ma: settings.ma.map((row) => row.color),
      maWidth: settings.ma.map((row) => row.width),
      conversion: settings.ichimoku.conversionColor,
      base: settings.ichimoku.baseColor,
      spanA: settings.ichimoku.spanAColor,
      spanB: settings.ichimoku.spanBColor,
      lagging: settings.ichimoku.laggingColor,
      ichimokuWidth: settings.ichimoku.width,
      bb: settings.bb.color,
      bbWidth: settings.bb.width,
      bmsbSma: settings.bmsb.smaColor,
      bmsbEma: settings.bmsb.emaColor,
      bmsbWidth: settings.bmsb.width,
      vwap: settings.vwap.color,
      vwapWidth: settings.vwap.width,
    }),
    [settings],
  );
  const changeUp = headerChange.change != null ? headerChange.change > 0 : null;
  const vwapNote = !isIntradayInterval(interval)
    ? intradayError
      ? "No intraday"
      : sessionVwapValue != null
        ? formatPx(sessionVwapValue)
        : "Intraday only"
    : null;

  return (
    <div data-chart-workspace className="flex min-h-0 flex-1 flex-col bg-[#0a0a0a] text-zinc-100" style={{ colorScheme: "dark" }}>
      <header className="flex flex-wrap items-center gap-3 border-b border-zinc-800 px-3 py-2">
        <form
          className="flex items-center gap-2"
          onSubmit={(event) => {
            event.preventDefault();
            const next = query.trim().toUpperCase();
            if (next) router.push(`/charts/${encodeURIComponent(next)}`);
          }}
        >
          <input
            ref={searchRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            aria-label="Ticker"
            placeholder="Ticker"
            className="h-9 w-28 rounded border border-zinc-400 bg-zinc-900 px-2 text-sm font-semibold tracking-wide text-zinc-100"
            style={{ colorScheme: "dark" }}
          />
        </form>
        <div className="flex gap-1">
          {INTERVALS.map((item) => (
            <button
              key={item.id}
              type="button"
              title={item.title}
              aria-pressed={interval === item.id}
              onClick={() => setInterval(item.id)}
              className={
                "h-8 rounded border px-2 text-xs font-semibold " +
                (interval === item.id ? "border-zinc-200 bg-zinc-800 text-zinc-100" : "border-zinc-400 bg-zinc-900 text-zinc-100")
              }
            >
              {item.label}
            </button>
          ))}
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-baseline gap-2">
            <span className="text-sm font-semibold text-zinc-100">{meta?.name ?? symbol}</span>
            <span className="text-xs text-zinc-300">
              {symbol} {intervalLabel(interval)} {meta?.exchange ?? ""}
            </span>
            {badge ? (
              <span className="rounded bg-amber-300 px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide text-zinc-950">
                {badge.label} {formatPx(badge.quote.price)}
              </span>
            ) : null}
            {fromCache ? <span className="text-[10px] text-zinc-300">Cached</span> : null}
          </div>
          {headerBar ? (
            <div className="mt-0.5 flex flex-wrap gap-3 font-mono text-xs text-zinc-100">
              <span>O {formatPx(headerBar.open)}</span>
              <span>H {formatPx(headerBar.high)}</span>
              <span>L {formatPx(headerBar.low)}</span>
              <span>C {formatPx(headerBar.close)}</span>
              <span className={changeUp == null ? "text-zinc-300" : changeUp ? "text-[#089981]" : "text-[#F23645]"}>
                {formatChange(headerChange.change, headerChange.changePct)}
              </span>
            </div>
          ) : (
            <div className="text-xs text-zinc-300">{loading ? "Loading candles…" : (error ?? "No bars")}</div>
          )}
        </div>
      </header>
      {!symbol ? (
        <SearchLanding recent={recent} onPick={(next) => router.push(`/charts/${encodeURIComponent(next)}`)} />
      ) : (
        <div className="flex min-h-0 flex-1">
          <ChartToolbar
            tool={tool}
            onTool={setTool}
            magnet={magnet}
            onMagnet={setMagnet}
            locked={document.locked}
            onLocked={(locked) => updateDocument({ ...document, locked })}
            hidden={document.hidden}
            onHidden={(hidden) => updateDocument({ ...document, hidden })}
            onDelete={() => {
              if (selectedId && !document.locked) {
                updateDocument({ ...document, drawings: document.drawings.filter((drawing) => drawing.id !== selectedId) });
                setSelectedId(null);
                return;
              }
              setTool("delete");
            }}
            pen={{ color: activePen.color, width: activePen.width, dash: activePen.dash }}
            onPen={onPen}
          />
          <div className="relative min-h-0 min-w-0 flex-1">
            {candles.length > 0 ? (
              <ChartStage
                key={`${symbol}-${interval}`}
                model={model}
                tool={tool}
                magnet={magnet}
                locked={document.locked}
                drawingsHidden={document.hidden}
                drawings={document.drawings}
                pen={{ color: activePen.color, width: activePen.width, dash: activePen.dash }}
                book={book}
                bookVisible={settings.book.visible}
                profile={profile}
                profileVisible={settings.profile.visible && profile != null && profile.length > 0}
                profileUp={settings.profile.up || CANDLE_UP}
                profileDown={settings.profile.down || CANDLE_DOWN}
                settingsVisible={stageVisible}
                colors={stageColors}
                onHover={setHover}
                onSelect={onSelect}
                onDrawingsChange={(drawings) => updateDocument({ ...document, drawings })}
              />
            ) : (
              <div className="flex h-full items-center justify-center text-sm text-zinc-300">{loading ? "Loading candles…" : (error ?? "No candles")}</div>
            )}
            <ChartLegend
              settings={settings}
              values={legend.bar ? legend : model.valuesAt(null)}
              vwapNote={settings.vwap.visible ? vwapNote : null}
              openGear={gear}
              onGear={setGear}
              onChange={setSettings}
            />
          </div>
        </div>
      )}
    </div>
  );
}

function intervalLabel(interval: ChartInterval): string {
  if (interval === "1d") return "1D";
  if (interval === "1wk") return "1W";
  if (interval === "1mo") return "1M";
  if (interval === "60m") return "1H";
  return interval;
}

function SearchLanding({ recent, onPick }: { recent: string[]; onPick: (symbol: string) => void }) {
  return (
    <div className="flex flex-1 flex-col gap-4 px-6 py-8">
      <h1 className="text-lg font-semibold text-zinc-100">Charts</h1>
      <p className="max-w-xl text-sm text-zinc-300">Search a ticker. Daily candles, the moving-average ribbon, and Ichimoku load first. Drawings stay on this machine.</p>
      {recent.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {recent.map((item) => (
            <button key={item} type="button" onClick={() => onPick(item)} className="h-8 rounded border border-zinc-400 bg-zinc-900 px-3 text-sm text-zinc-100">
              {item}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
