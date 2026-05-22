export type DataMode = "auto" | "schwab";

export const DATA_MODE_COOKIE = "fh_data_mode";

export function parseDataMode(v: unknown): DataMode {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "schwab" || s === "auto") return s;
  return "auto";
}

