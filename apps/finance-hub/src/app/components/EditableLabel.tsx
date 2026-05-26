"use client";

import { useCallback, useEffect, useState } from "react";

export function EditableLabel({
  value,
  defaultValue,
  onCommit,
  className,
  inputClassName,
  title = "Double-click to rename",
  editTitle = "Enter to save · Esc to cancel",
}: {
  value: string;
  defaultValue: string;
  onCommit: (next: string | null) => void;
  className?: string;
  inputClassName?: string;
  title?: string;
  editTitle?: string;
}) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(value);

  useEffect(() => {
    if (!editing) setDraft(value);
  }, [value, editing]);

  const commit = useCallback(() => {
    const trimmed = draft.trim();
    onCommit(trimmed && trimmed !== defaultValue ? trimmed : null);
    setEditing(false);
  }, [draft, defaultValue, onCommit]);

  const cancel = useCallback(() => {
    setDraft(value);
    setEditing(false);
  }, [value]);

  if (editing) {
    return (
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit();
          } else if (e.key === "Escape") {
            e.preventDefault();
            cancel();
          }
        }}
        onClick={(e) => e.stopPropagation()}
        onDoubleClick={(e) => e.stopPropagation()}
        className={
          inputClassName ??
          "min-w-0 flex-1 rounded border border-zinc-300 bg-white px-1.5 py-0.5 text-sm font-semibold text-zinc-900 shadow-sm dark:border-white/25 dark:bg-zinc-950 dark:text-zinc-50"
        }
        title={editTitle}
      />
    );
  }

  return (
    <span
      className={className}
      title={title}
      onDoubleClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setDraft(value);
        setEditing(true);
      }}
    >
      {value}
    </span>
  );
}
