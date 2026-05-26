"use client";

import { useCallback, useEffect, useState, type ElementType } from "react";

import { EditableLabel } from "@/app/components/EditableLabel";
import { readColumnLabel, writeColumnLabel } from "@/lib/ui/displayLabels";

export function ColumnLabel({
  tableKey,
  columnId,
  defaultLabel,
  className,
}: {
  tableKey: string;
  columnId: string;
  defaultLabel: string;
  className?: string;
}) {
  const [label, setLabel] = useState(defaultLabel);

  useEffect(() => {
    setLabel(readColumnLabel(tableKey, columnId, defaultLabel));
  }, [tableKey, columnId, defaultLabel]);

  const onCommit = useCallback(
    (next: string | null) => {
      setLabel(writeColumnLabel(tableKey, columnId, next, defaultLabel));
    },
    [tableKey, columnId, defaultLabel],
  );

  return (
    <EditableLabel
      value={label}
      defaultValue={defaultLabel}
      onCommit={onCommit}
      className={className}
    />
  );
}
