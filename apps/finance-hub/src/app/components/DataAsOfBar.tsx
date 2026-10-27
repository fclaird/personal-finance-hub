"use client";

function formatAsOf(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
    second: "2-digit",
  });
}

export function DataAsOfBar({
  asOf,
  stale = false,
  busy = false,
  onRefresh,
}: {
  asOf: string | null;
  stale?: boolean;
  busy?: boolean;
  onRefresh: () => void;
}) {
  const label = asOf ? formatAsOf(asOf) : busy ? "Loading…" : "—";
  return (
    <div className="flex flex-wrap items-center justify-end gap-2">
      <p className="text-sm text-zinc-800 dark:text-zinc-200">
        As of{" "}
        <time dateTime={asOf ?? undefined} className="font-medium tabular-nums">
          {label}
        </time>
        {stale ? <span className="text-zinc-700 dark:text-zinc-300"> · updating</span> : null}
      </p>
      <button
        type="button"
        onClick={onRefresh}
        disabled={busy}
        className="rounded-md border border-zinc-400 bg-white px-3 py-1.5 text-sm font-semibold text-zinc-950 hover:bg-zinc-100 disabled:opacity-60 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-zinc-900"
      >
        {busy ? "Refreshing…" : "Refresh"}
      </button>
    </div>
  );
}
