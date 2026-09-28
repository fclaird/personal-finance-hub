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

  const problem = useMemo(() => {
    if (!status || (status.ok && status.connected)) return null;
    if (status.ok === false) return `Schwab status error: ${status.error}`;
    return "Schwab is not connected.";
  }, [status]);

  if (!problem) return null;

  return (
    <div className="bg-red-600 text-white">
      <div className="flex w-full max-w-[120rem] items-center justify-between gap-4 py-2.5 pl-5 pr-7 text-[15px] leading-snug">
        <div className="min-w-0 truncate font-semibold">{problem}</div>
        <Link href="/connections" className="shrink-0 rounded-full bg-white/15 px-3.5 py-1.5 text-[13px] font-bold hover:bg-white/25">
          Connections
        </Link>
      </div>
    </div>
  );
}

