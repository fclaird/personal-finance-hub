"use client";

import { useCallback, useEffect, useState } from "react";

import { formatUsd2 } from "@/lib/format";

const SESSION_KEY = "fh.portfolioGlanceValueUnlocked.v1";
const UNLOCK_PASSWORD = "sohcahto";

export function PortfolioGlanceValue({ netValue }: { netValue: number | null | undefined }) {
  const [unlocked, setUnlocked] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [error, setError] = useState(false);

  useEffect(() => {
    try {
      setUnlocked(sessionStorage.getItem(SESSION_KEY) === "1");
    } catch {
      // ignore
    }
  }, []);

  const lock = useCallback(() => {
    setUnlocked(false);
    setEditing(false);
    setDraft("");
    setError(false);
    try {
      sessionStorage.removeItem(SESSION_KEY);
    } catch {
      // ignore
    }
  }, []);

  const tryUnlock = useCallback(() => {
    if (draft !== UNLOCK_PASSWORD) {
      setError(true);
      return;
    }
    setUnlocked(true);
    setEditing(false);
    setDraft("");
    setError(false);
    try {
      sessionStorage.setItem(SESSION_KEY, "1");
    } catch {
      // ignore
    }
  }, [draft]);

  if (unlocked) {
    return (
      <button
        type="button"
        onClick={lock}
        className="truncate text-right text-sm font-semibold leading-5 tabular-nums text-zinc-900 hover:opacity-80 dark:text-zinc-50"
        title="Click to hide balance"
      >
        {formatUsd2(netValue)}
      </button>
    );
  }

  if (editing) {
    return (
      <form
        className="flex min-w-0 items-center justify-end gap-1"
        onSubmit={(e) => {
          e.preventDefault();
          tryUnlock();
        }}
      >
        <input
          autoFocus
          type="password"
          value={draft}
          onChange={(e) => {
            setDraft(e.target.value);
            setError(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Escape") {
              setEditing(false);
              setDraft("");
              setError(false);
            }
          }}
          placeholder="Password"
          className={
            "w-[5.5rem] rounded border bg-white px-1.5 py-0 text-right text-sm leading-5 dark:bg-zinc-950 " +
            (error
              ? "border-red-400 dark:border-red-500"
              : "border-zinc-300 dark:border-white/20")
          }
          aria-label="Password to show portfolio balance"
        />
      </form>
    );
  }

  return (
    <button
      type="button"
      onClick={() => {
        setEditing(true);
        setError(false);
      }}
      className="truncate text-right text-sm font-medium leading-5 text-zinc-500 underline-offset-2 hover:text-zinc-700 hover:underline dark:text-zinc-400 dark:hover:text-zinc-200"
      title="Enter password to show portfolio balance"
    >
      Unlock balance
    </button>
  );
}
