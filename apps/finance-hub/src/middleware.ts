import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { authorizeApiRequest } from "@/lib/apiAuth";
import { FLAVOR_COOKIE, parseFlavor } from "@/lib/flavor";
import { defaultNavHref, isPathAllowedForFlavor } from "@/lib/flavors/registry";

const OAUTH_API_PREFIXES = ["/api/schwab/start", "/api/schwab/callback", "/api/x/oauth/"];

function isOAuthApiPath(pathname: string): boolean {
  return OAUTH_API_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (isOAuthApiPath(pathname)) {
      return NextResponse.next();
    }
    if (!authorizeApiRequest(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  const flavor = parseFlavor(req.cookies.get(FLAVOR_COOKIE)?.value);

  if (!flavor) {
    if (pathname === "/connections" || pathname.startsWith("/connections/")) {
      return NextResponse.next();
    }
    const url = req.nextUrl.clone();
    url.pathname = "/connections";
    return NextResponse.redirect(url);
  }

  if (pathname === "/") {
    const url = req.nextUrl.clone();
    const connected = req.cookies.get("fh_schwab_connected")?.value === "1";
    url.pathname = connected ? "/allocation" : "/connections";
    return NextResponse.redirect(url);
  }

  if (!isPathAllowedForFlavor(pathname, flavor)) {
    const url = req.nextUrl.clone();
    url.pathname = defaultNavHref(flavor);
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/api/:path*", "/((?!_next/static|_next/image|favicon.ico).*)"],
};
