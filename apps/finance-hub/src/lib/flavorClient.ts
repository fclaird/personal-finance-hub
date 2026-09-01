import { FLAVOR_COOKIE, parseFlavor, type FlavorId } from "@/lib/flavor";

/** Read active flavor from document cookie (client-only; cookie is not httpOnly). */
export function readFlavorCookieClient(): FlavorId | null {
  if (typeof document === "undefined") return null;
  const m = document.cookie.match(new RegExp(`(?:^|;\\s*)${FLAVOR_COOKIE}=([^;]*)`));
  if (!m?.[1]) return null;
  return parseFlavor(decodeURIComponent(m[1].trim()));
}
