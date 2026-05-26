"use client";

import { useEffect, useRef, useState } from "react";

import type { GlanceAlternateInstrumentId } from "@/lib/market/glanceAlternateInstrumentIds";

type Option = {
  id: GlanceAlternateInstrumentId;
  label: string;
};

export function GlanceAlternateTileTitle({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: ReadonlyArray<Option>;
  value: GlanceAlternateInstrumentId;
  onChange: (id: GlanceAlternateInstrumentId) => void;
}) {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    function onPointerDown(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative min-w-0">
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex max-w-full items-center gap-1 text-left text-xs font-medium text-zinc-700 hover:text-zinc-900 dark:text-zinc-200 dark:hover:text-zinc-50"
        title="Choose alternate market tile"
      >
        <span className="truncate">{label}</span>
        <span aria-hidden className="shrink-0 text-[10px] text-zinc-400">
          ▾
        </span>
      </button>
      {open ? (
        <ul
          role="listbox"
          aria-label="Alternate market tile"
          className="absolute left-0 top-full z-20 mt-1 min-w-[10.5rem] overflow-hidden rounded-lg border border-zinc-300 bg-white py-1 shadow-lg dark:border-white/20 dark:bg-zinc-950"
        >
          {options.map((option) => {
            const selected = option.id === value;
            return (
              <li key={option.id} role="presentation">
                <button
                  type="button"
                  role="option"
                  aria-selected={selected}
                  onClick={() => {
                    onChange(option.id);
                    setOpen(false);
                  }}
                  className={
                    "block w-full px-2.5 py-1.5 text-left text-xs " +
                    (selected
                      ? "bg-zinc-100 font-semibold text-zinc-900 dark:bg-white/10 dark:text-zinc-50"
                      : "text-zinc-700 hover:bg-zinc-50 dark:text-zinc-200 dark:hover:bg-white/5")
                  }
                >
                  {option.label}
                </button>
              </li>
            );
          })}
        </ul>
      ) : null}
    </div>
  );
}
