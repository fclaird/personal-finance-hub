import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  if (pathname === "/") {
    const url = req.nextUrl.clone();
    // Gate: if Schwab token exists, treat Allocation as home.
    // We can't read the encrypted token file at the edge, so we gate on a lightweight cookie.
    // If the cookie isn't present, default to Connections.
    const connected = req.cookies.get("fh_schwab_connected")?.value === "1";
    url.pathname = connected ? "/allocation" : "/connections";
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ["/"],
};

