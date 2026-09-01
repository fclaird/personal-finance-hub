"use client";

import {
  TERMINAL_PERF_DISPLAY_LABEL,
  TERMINAL_PERF_DISPLAY_MODES,
  type TerminalPerfDisplayMode,
} from "@/lib/terminal/terminalPerfDisplay";

const BTN =
  "flex h-8 min-w-0 shrink-0 items-center justify-center whitespace-nowrap rounded-md px-2.5 text-xs font-semibold tracking-tight";

function btnClass(active: boolean) {
  return (
    BTN +
    " " +
    (active
      ? "bg-zinc-950 text-white dark:bg-white dark:text-black"
      : "border border-zinc-300 bg-white text-zinc-900 hover:bg-zinc-50 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:hover:bg-white/5")
  );
}

export function TerminalPerfDisplayControls({
  mode,
  onModeChange,
}: {
  mode: TerminalPerfDisplayMode;
  onModeChange: (mode: TerminalPerfDisplayMode) => void;
}) {
  return (
    <div className="mb-3 flex flex-wrap items-end gap-x-4 gap-y-2">
      <div className="flex min-w-0 flex-col gap-1">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 dark:text-zinc-400">
          Day change
        </span>
        <div className="flex flex-wrap items-center gap-1">
          {TERMINAL_PERF_DISPLAY_MODES.map((m) => (
            <button key={m} type="button" onClick={() => onModeChange(m)} className={btnClass(mode === m)}>
              {TERMINAL_PERF_DISPLAY_LABEL[m]}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
