"use client";

import { useEffect, useState } from "react";

import type { FlavorId } from "@/lib/flavor";

const inputClass =
  "h-10 w-full rounded-md border border-zinc-300 bg-white px-3 text-sm text-zinc-900 shadow-sm dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100";

export function FlavorPasswordDialog({
  flavor,
  label,
  passwordRequired,
  open,
  onClose,
  onSuccess,
}: {
  flavor: FlavorId | null;
  label: string;
  passwordRequired?: boolean;
  open: boolean;
  onClose: () => void;
  onSuccess: (flavor: FlavorId) => void;
}) {
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  useEffect(() => {
    if (open) {
      setPassword("");
      setError(null);
    }
  }, [open, flavor]);

  if (!open || !flavor) return null;

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const resp = await fetch("/api/flavor", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ flavor, password }),
      });
      const json = (await resp.json()) as { ok: boolean; flavor?: FlavorId; error?: string };
      if (json.ok && json.flavor) {
        onSuccess(json.flavor);
        return;
      }
      setError(json.error ?? "Incorrect password");
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not verify password");
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="flavor-password-title"
    >
      <form
        onSubmit={(e) => void submit(e)}
        className="w-full max-w-sm rounded-xl border border-zinc-300 bg-white p-5 shadow-xl dark:border-white/20 dark:bg-zinc-950"
      >
        <h2 id="flavor-password-title" className="text-lg font-semibold text-zinc-900 dark:text-zinc-50">
          Enter password
        </h2>
        <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400">
          Unlock the <span className="font-medium text-zinc-900 dark:text-zinc-100">{label}</span> flavor to continue
          to the terminal.
          {passwordRequired === false ? (
            <span className="mt-1 block text-xs text-zinc-500 dark:text-zinc-500">
              No flavor password configured — click Continue.
            </span>
          ) : null}
        </p>
        <label className="mt-4 block space-y-1 text-sm">
          <span className="font-medium text-zinc-800 dark:text-zinc-200">Password</span>
          <input
            type="password"
            autoFocus
            autoComplete="current-password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className={inputClass}
            disabled={submitting}
          />
        </label>
        {error ? (
          <p className="mt-3 text-sm text-red-600 dark:text-red-400" role="alert">
            {error}
          </p>
        ) : null}
        <div className="mt-5 flex justify-end gap-2">
          <button
            type="button"
            onClick={onClose}
            disabled={submitting}
            className="rounded-full border border-zinc-300 px-4 py-2 text-sm font-medium text-zinc-900 hover:bg-zinc-50 disabled:opacity-50 dark:border-white/20 dark:text-zinc-100 dark:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={submitting}
            className="rounded-full bg-zinc-950 px-4 py-2 text-sm font-medium text-white hover:bg-zinc-800 disabled:opacity-50 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {submitting ? "Verifying…" : "Continue"}
          </button>
        </div>
      </form>
    </div>
  );
}
