export const FLAVOR_COOKIE = "fh_flavor";

export const FLAVOR_IDS = ["main", "rorie"] as const;
export type FlavorId = (typeof FLAVOR_IDS)[number];

export function parseFlavor(v: unknown): FlavorId | null {
  const s = typeof v === "string" ? v.trim().toLowerCase() : "";
  if (s === "main" || s === "rorie") return s;
  return null;
}

export function isValidFlavor(v: unknown): v is FlavorId {
  return parseFlavor(v) != null;
}
