"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";

type SchwabStatus =
  | { ok: true; connected: false }
  | { ok: true; connected: true; obtainedAt: number; expiresAt: number; accessValid: boolean }
  | { ok: false; error: string };

export function LiveStatusBanner() {
  const [status, setStatus] = useState<SchwabStatus | null>(null);

  async function load() {
    try {
      const resp = await fetch("/api/schwab/status", { cache: "no-store" });
      const json = (await resp.json()) as SchwabStatus;
      setStatus(json);
    } catch (e) {
      setStatus({ ok: false, error: e instanceof Error ? e.message : String(e) });
    }
  }

  useEffect(() => {
    const t = setTimeout(() => void load(), 0);
    return () => clearTimeout(t);
  }, []);

  const view = useMemo(() => {
    if (!status) return { live: null as null | boolean, text: "Checking Schwab status…" };
    if (status.ok === false) return { live: false, text: `LIVE status error: ${status.error}` };
    if (!status.connected) return { live: false, text: "NOT LIVE: Connect Schwab to view live data." };
    return { live: true, text: status.accessValid ? "LIVE (Schwab): Connected." : "LIVE (Schwab): Connected (token will refresh on next API call)." };
  }, [status]);

  const live = view.live;
  const bg =
    live === true
      ? "bg-blue-600 text-white"
      : live === false
        ? "bg-red-600 text-white"
        : "bg-zinc-200 text-zinc-900 dark:bg-white/10 dark:text-zinc-200";

  return (
    <div className={bg}>
      <div className="flex w-full max-w-[120rem] items-center justify-between gap-4 py-2.5 pl-5 pr-7 text-[15px] leading-snug">
        <div className="min-w-0 truncate font-semibold">{view.text}</div>
        {live !== true ? (
          <Link href="/connections" className="shrink-0 rounded-full bg-white/15 px-3.5 py-1.5 text-[13px] font-bold hover:bg-white/25">
            Connections
          </Link>
        ) : null}
      </div>
    </div>
  );
}

