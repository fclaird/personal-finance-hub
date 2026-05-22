export const PRIVACY_COOKIE = "fh_privacy";

export type PrivacyMode = "on" | "off";

export function parsePrivacyCookie(v: unknown): PrivacyMode {
  const s = typeof v === "string" ? v.trim() : "";
  return s === "1" || s.toLowerCase() === "on" || s.toLowerCase() === "true" ? "on" : "off";
}

export function privacyCookieValue(mode: PrivacyMode): string {
  return mode === "on" ? "1" : "0";
}

