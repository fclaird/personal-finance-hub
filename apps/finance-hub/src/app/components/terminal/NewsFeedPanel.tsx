"use client";

import { useCallback, useEffect, useState } from "react";

import { useMarketAwareInterval } from "@/hooks/useMarketAwareInterval";
import { formatDisplayDate } from "@/lib/formatDate";
import type { NewsItem } from "@/lib/news/types";

type Props = {
  title?: string;
  mode?: "default" | "company";
  symbols?: string[];
  companyName?: string | null;
  anomalySymbols?: string[];
  maxItems?: number;
  className?: string;
};

function isExternalLink(link: string): boolean {
  return link.startsWith("http://") || link.startsWith("https://");
}

function formatNewsTime(pubDate: string): string {
  const t = Date.parse(pubDate);
  if (!Number.isFinite(t)) return "—";
  const d = new Date(t);
  const now = Date.now();
  const diffH = (now - t) / 3_600_000;
  if (diffH < 24) {
    return d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }
  return formatDisplayDate(d.toISOString().slice(0, 10), { short: true });
}

export function NewsFeedPanel({
  title = "Market news",
  mode = "default",
  symbols = [],
  companyName = null,
  anomalySymbols = [],
  maxItems = 20,
  className = "",
}: Props) {
  const [items, setItems] = useState<NewsItem[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  const symbolsKey = symbols
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join(",");
  const anomaliesKey = anomalySymbols
    .map((s) => s.trim().toUpperCase())
    .filter(Boolean)
    .sort()
    .join(",");

  const load = useCallback(async () => {
    setError(null);
    try {
      const qs = new URLSearchParams();
      qs.set("mode", mode);
      if (symbolsKey) qs.set("symbols", symbolsKey);
      if (anomaliesKey) qs.set("anomalies", anomaliesKey);
      if (companyName?.trim()) qs.set("companyName", companyName.trim());
      const resp = await fetch(`/api/terminal/news?${qs}`, { cache: "no-store" });
      const json = (await resp.json()) as { ok: boolean; items?: NewsItem[]; error?: string };
      if (!json.ok) throw new Error(json.error ?? "Failed to load news");
      setItems((json.items ?? []).slice(0, maxItems));
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setItems([]);
    } finally {
      setLoading(false);
    }
  }, [mode, symbolsKey, anomaliesKey, companyName, maxItems]);

  useEffect(() => {
    setLoading(true);
    void load();
  }, [load]);

  useMarketAwareInterval(() => void load(), 60_000, 600_000, `${mode}|${symbolsKey}|${anomaliesKey}`, false);

  return (
    <div className={className}>
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{title}</div>
        <p className="text-[11px] text-zinc-500 dark:text-zinc-400">
          CaktusJxck via Shortcut · Yahoo · RSS
        </p>
      </div>

      {error ? (
        <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-xs text-red-900 dark:bg-red-950/30 dark:text-red-200">
          {error}
        </div>
      ) : null}

      {loading && items.length === 0 ? (
        <div className="mt-3 text-sm text-zinc-500 dark:text-zinc-400">Loading news…</div>
      ) : items.length === 0 ? (
        <div className="mt-3 rounded-lg border border-dashed border-zinc-300 px-4 py-6 text-sm text-zinc-600 dark:border-white/20 dark:text-zinc-400">
          No headlines yet. Share a CaktusJxck post from WhatsApp using your iOS Shortcut (see{" "}
          <span className="font-mono text-xs">docs/CACTUSJXCK_NEWS_INGEST.md</span>).
        </div>
      ) : (
        <ul className="mt-3 max-h-[28rem] space-y-2 overflow-y-auto pr-1">
          {items.map((it) => {
            const external = isExternalLink(it.link);
            return (
              <li
                key={`${it.link}|${it.title}`}
                className="rounded-lg border border-zinc-200 bg-white/60 px-3 py-2.5 dark:border-white/10 dark:bg-white/5"
              >
                <div className="flex flex-wrap items-center gap-2 text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
                  <span>{it.source}</span>
                  <span aria-hidden>·</span>
                  <span className="tabular-nums normal-case">{formatNewsTime(it.pubDate)}</span>
                  {it.symbols.length > 0 ? (
                    <span className="ml-auto flex flex-wrap gap-1 normal-case">
                      {it.symbols.slice(0, 4).map((s) => (
                        <span
                          key={s}
                          className="rounded bg-zinc-200/80 px-1.5 py-0.5 font-mono text-[10px] text-zinc-700 dark:bg-white/10 dark:text-zinc-300"
                        >
                          {s}
                        </span>
                      ))}
                    </span>
                  ) : null}
                </div>
                {external ? (
                  <a
                    href={it.link}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="mt-1 block text-sm font-medium leading-snug text-sky-800 hover:underline dark:text-sky-300"
                  >
                    {it.title}
                  </a>
                ) : (
                  <div className="mt-1 text-sm font-medium leading-snug text-zinc-900 dark:text-zinc-100">{it.title}</div>
                )}
                {it.body && it.body !== it.title ? (
                  <p className="mt-1 line-clamp-2 text-xs leading-relaxed text-zinc-600 dark:text-zinc-400">{it.body}</p>
                ) : null}
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
