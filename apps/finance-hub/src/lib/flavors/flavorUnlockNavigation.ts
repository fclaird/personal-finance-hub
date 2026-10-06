import { FLAVOR_COOKIE, type FlavorId } from "@/lib/flavor";
import { defaultNavHref } from "@/lib/flavors/registry";

const YEAR_SECONDS = 365 * 24 * 3600;

export type FlavorCookieAttributes = {
  httpOnly: true;
  sameSite: "lax";
  secure: boolean;
  path: "/";
  maxAge: number;
};

/**
 * A flavor unlock has to navigate with a relative Location.
 * Building an absolute URL from the request the server sees turns
 * https://127.0.0.1 into https://localhost under the https dev proxy.
 * fh_flavor is host-only, so that hop arrives without the cookie and
 * middleware sends the browser back to /connections.
 */
export function sameHostPath(location: string): string {
  if (!location.startsWith("/") || location.startsWith("//")) {
    throw new Error("Flavor unlock redirect must stay on the hub host");
  }
  return location;
}

export function flavorCookieAttributes(secure: boolean): FlavorCookieAttributes {
  return {
    httpOnly: true,
    sameSite: "lax",
    secure,
    path: "/",
    maxAge: YEAR_SECONDS,
  };
}

export function flavorCookieSecure(req: { url: string; headers: { get(name: string): string | null } }): boolean {
  const forwarded = req.headers.get("x-forwarded-proto")?.split(",")[0]?.trim().toLowerCase();
  if (forwarded === "https") return true;
  if (forwarded === "http") return false;
  try {
    return new URL(req.url).protocol === "https:";
  } catch {
    return false;
  }
}

export function isDocumentUnlock(req: { headers: { get(name: string): string | null } }): boolean {
  if (req.headers.get("sec-fetch-dest") === "document") return true;
  const contentType = req.headers.get("content-type") ?? "";
  return (
    contentType.includes("application/x-www-form-urlencoded") || contentType.includes("multipart/form-data")
  );
}

export function flavorUnlockFailureLocation(flavor: FlavorId | null): string {
  const params = new URLSearchParams();
  params.set("flavorUnlock", "invalid");
  if (flavor) params.set("flavor", flavor);
  return sameHostPath(`/connections?${params.toString()}`);
}

export type FlavorUnlockPlan =
  | { kind: "json-error"; status: 400 | 401; error: string }
  | { kind: "document-error"; status: 303; location: string }
  | {
      kind: "json-ok";
      status: 200;
      flavor: FlavorId;
      cookie: FlavorCookieAttributes;
    }
  | {
      kind: "document-ok";
      status: 303;
      flavor: FlavorId;
      location: string;
      cookie: FlavorCookieAttributes;
    };

export function planFlavorUnlock(input: {
  document: boolean;
  flavor: FlavorId | null;
  passwordOk: boolean;
  secure: boolean;
}): FlavorUnlockPlan {
  if (!input.flavor) {
    if (input.document) return { kind: "document-error", status: 303, location: flavorUnlockFailureLocation(null) };
    return { kind: "json-error", status: 400, error: "Invalid flavor" };
  }
  if (!input.passwordOk) {
    if (input.document) {
      return { kind: "document-error", status: 303, location: flavorUnlockFailureLocation(input.flavor) };
    }
    return { kind: "json-error", status: 401, error: "Incorrect password" };
  }
  const cookie = flavorCookieAttributes(input.secure);
  if (input.document) {
    return {
      kind: "document-ok",
      status: 303,
      flavor: input.flavor,
      location: sameHostPath(defaultNavHref(input.flavor)),
      cookie,
    };
  }
  return { kind: "json-ok", status: 200, flavor: input.flavor, cookie };
}

/** Host-only cookie: sent only to the hostname that set it, and only over https when Secure. */
export function flavorCookieSentTo(cookie: FlavorCookieAttributes, from: URL, to: URL): boolean {
  if (from.hostname !== to.hostname) return false;
  if (cookie.secure && to.protocol !== "https:") return false;
  return to.pathname === cookie.path || to.pathname.startsWith(cookie.path === "/" ? "/" : `${cookie.path}/`);
}

export function unlockFollowRequest(from: URL, location: string): URL {
  return new URL(sameHostPath(location), from);
}

export { FLAVOR_COOKIE };
