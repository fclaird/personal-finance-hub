"use client";

import { useCallback, useEffect, useState, type ElementType } from "react";

import { EditableLabel } from "@/app/components/EditableLabel";
import { readHeadingLabel, writeHeadingLabel } from "@/lib/ui/displayLabels";

export function EditableHeading({
  namespace,
  id,
  defaultLabel,
  className,
  as: Tag = "span",
}: {
  namespace: string;
  id: string;
  defaultLabel: string;
  className?: string;
  as?: ElementType;
}) {
  const [label, setLabel] = useState(defaultLabel);

  useEffect(() => {
    setLabel(readHeadingLabel(namespace, id, defaultLabel));
  }, [namespace, id, defaultLabel]);

  const onCommit = useCallback(
    (next: string | null) => {
      setLabel(writeHeadingLabel(namespace, id, next, defaultLabel));
    },
    [namespace, id, defaultLabel],
  );

  return (
    <Tag className={className}>
      <EditableLabel value={label} defaultValue={defaultLabel} onCommit={onCommit} className="cursor-text" />
    </Tag>
  );
}

const PAGE_NAMESPACE = "fh.pages";

export function EditablePageHeading({
  pageId,
  defaultTitle,
  className,
}: {
  pageId: string;
  defaultTitle: string;
  className?: string;
}) {
  return (
    <EditableHeading
      namespace={PAGE_NAMESPACE}
      id={pageId}
      defaultLabel={defaultTitle}
      className={className}
      as="span"
    />
  );
}
