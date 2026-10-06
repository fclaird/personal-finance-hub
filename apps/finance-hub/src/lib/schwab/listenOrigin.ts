export function expectedSchwabOrigin(redirectUri: string | null | undefined): string | null {
  const raw = redirectUri?.trim();
  if (!raw) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "http:" && url.protocol !== "https:") return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function requestOrigin(
  host: string | null | undefined,
  forwardedProto: string | null | undefined,
): string | null {
  const trimmedHost = host?.trim();
  if (!trimmedHost) return null;
  const proto = (forwardedProto ?? "http").split(",")[0]?.trim() || "http";
  if (proto !== "http" && proto !== "https") return null;
  return `${proto}://${trimmedHost}`;
}

export function schwabListenMismatch(pageOrigin: string, redirectUri: string | null | undefined): string | null {
  const expected = expectedSchwabOrigin(redirectUri);
  if (!expected || pageOrigin === expected) return null;
  const target = redirectUri?.trim() || expected;
  return `This page is ${pageOrigin}. Schwab will send the browser to ${target}. Open ${expected}/connections before reconnecting. If that address does not load, stop the hub and run: npm start`;
}
