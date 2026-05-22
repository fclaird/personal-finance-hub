"use client";

import { useCallback, useEffect, useState } from "react";

import { formatDisplayDateTime } from "@/lib/formatDate";

type Props = { symbol: string };

export function SymbolNotesSection({ symbol }: Props) {
  const [notesDraft, setNotesDraft] = useState("");
  const [notesSaved, setNotesSaved] = useState("");
  const [notesUpdatedAt, setNotesUpdatedAt] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const notesDirty = notesDraft !== notesSaved;

  const loadNotes = useCallback(async () => {
    if (!symbol) return;
    setLoading(true);
    setError(null);
    try {
      const resp = await fetch(`/api/terminal/symbol-notes?symbol=${encodeURIComponent(symbol)}`, {
        cache: "no-store",
      });
      const json = (await resp.json()) as {
        ok?: boolean;
        body?: string;
        updatedAt?: string | null;
        error?: string;
      };
      if (!json.ok) throw new Error(json.error ?? "Failed to load notes");
      const body = json.body ?? "";
      setNotesDraft(body);
      setNotesSaved(body);
      setNotesUpdatedAt(json.updatedAt ?? null);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setLoading(false);
    }
  }, [symbol]);

  const saveNotes = useCallback(async () => {
    if (!symbol || saving) return;
    setSaving(true);
    setError(null);
    try {
      const resp = await fetch("/api/terminal/symbol-notes", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ symbol, body: notesDraft }),
      });
      const json = (await resp.json()) as {
        ok?: boolean;
        body?: string;
        updatedAt?: string;
        error?: string;
      };
      if (!json.ok) throw new Error(json.error ?? "Failed to save notes");
      const body = json.body ?? notesDraft;
      setNotesDraft(body);
      setNotesSaved(body);
      setNotesUpdatedAt(json.updatedAt ?? new Date().toISOString());
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setSaving(false);
    }
  }, [symbol, saving, notesDraft]);

  useEffect(() => {
    const t = setTimeout(() => void loadNotes(), 0);
    return () => clearTimeout(t);
  }, [loadNotes]);

  return (
    <div className="mt-4 rounded-xl border border-zinc-300 bg-white/60 p-4 dark:border-white/20 dark:bg-black/20">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <div className="text-sm font-semibold">Your notes</div>
          <p className="mt-1 text-xs text-zinc-600 dark:text-zinc-400">
            Private notes for this ticker — stored locally on your machine and editable anytime.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {notesUpdatedAt ? (
            <span className="text-xs text-zinc-500 dark:text-zinc-500">
              Saved {formatDisplayDateTime(notesUpdatedAt)}
            </span>
          ) : null}
          <button
            type="button"
            disabled={loading || saving || !notesDirty}
            onClick={() => void saveNotes()}
            className="h-8 rounded-md bg-zinc-950 px-3 text-xs font-semibold text-white hover:bg-zinc-900 disabled:opacity-40 dark:bg-white dark:text-black dark:hover:bg-zinc-200"
          >
            {saving ? "Saving…" : notesDirty ? "Save notes" : "Saved"}
          </button>
        </div>
      </div>
      {error ? <div className="mt-2 text-sm text-red-800 dark:text-red-200/90">{error}</div> : null}
      {loading ? (
        <div className="mt-3 text-sm text-zinc-600 dark:text-zinc-400">Loading notes…</div>
      ) : (
        <textarea
          value={notesDraft}
          onChange={(e) => setNotesDraft(e.target.value)}
          onBlur={() => {
            if (notesDirty && !saving) void saveNotes();
          }}
          placeholder="Thesis, risks, position context, links…"
          rows={6}
          className="mt-3 w-full resize-y rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm leading-relaxed text-zinc-900 shadow-sm placeholder:text-zinc-400 focus:border-zinc-500 focus:outline-none focus:ring-1 focus:ring-zinc-500 dark:border-white/20 dark:bg-zinc-950 dark:text-zinc-100 dark:placeholder:text-zinc-500 dark:focus:border-white/40 dark:focus:ring-white/30"
        />
      )}
    </div>
  );
}
