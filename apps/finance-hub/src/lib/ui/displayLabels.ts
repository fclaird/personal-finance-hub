const HEADINGS_KEY = "fh.ui.headings.v1";
const COLUMN_LABELS_KEY = "fh.ui.column_labels.v1";

type LabelStore = Record<string, string>;

function readStore(key: string): LabelStore {
  try {
    const raw = localStorage.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as unknown;
    if (!parsed || typeof parsed !== "object") return {};
    const out: LabelStore = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "string" && v.trim()) out[k] = v.trim();
    }
    return out;
  } catch {
    return {};
  }
}

function writeStore(key: string, store: LabelStore): void {
  try {
    if (Object.keys(store).length === 0) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(store));
  } catch {
    // ignore quota
  }
}

function readLabel(key: string, storeKey: string, defaultLabel: string): string {
  const v = readStore(storeKey)[key];
  return v ?? defaultLabel;
}

function writeLabel(key: string, storeKey: string, label: string | null, defaultLabel: string): string {
  const store = readStore(storeKey);
  const trimmed = label?.trim() ?? "";
  if (!trimmed || trimmed === defaultLabel) {
    delete store[key];
  } else {
    store[key] = trimmed;
  }
  writeStore(storeKey, store);
  return trimmed && trimmed !== defaultLabel ? trimmed : defaultLabel;
}

/** Stable key for tile / section headings (`namespace` is usually a page storage key). */
export function headingLabelKey(namespace: string, id: string): string {
  return `${namespace}::${id}`;
}

export function readHeadingLabel(namespace: string, id: string, defaultLabel: string): string {
  return readLabel(headingLabelKey(namespace, id), HEADINGS_KEY, defaultLabel);
}

export function writeHeadingLabel(namespace: string, id: string, label: string | null, defaultLabel: string): string {
  return writeLabel(headingLabelKey(namespace, id), HEADINGS_KEY, label, defaultLabel);
}

export function readAllHeadingLabels(): LabelStore {
  return readStore(HEADINGS_KEY);
}

/** Stable key for table column headers (`tableKey` identifies the table). */
export function columnLabelKey(tableKey: string, columnId: string): string {
  return `${tableKey}::${columnId}`;
}

export function readColumnLabel(tableKey: string, columnId: string, defaultLabel: string): string {
  return readLabel(columnLabelKey(tableKey, columnId), COLUMN_LABELS_KEY, defaultLabel);
}

export function writeColumnLabel(
  tableKey: string,
  columnId: string,
  label: string | null,
  defaultLabel: string,
): string {
  return writeLabel(columnLabelKey(tableKey, columnId), COLUMN_LABELS_KEY, label, defaultLabel);
}

export function readAllColumnLabels(): LabelStore {
  return readStore(COLUMN_LABELS_KEY);
}
