import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

import { authorizeApiRequest } from "@/lib/apiAuth";

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/")) {
    if (!authorizeApiRequest(req)) {
      return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
    }
    return NextResponse.next();
  }

  if (pathname === "/") {
    const url = req.nextUrl.clone();
    const connected = req.cookies.get("fh_schwab_connected")?.value === "1";
    url.pathname = connected ? "/allocation" : "/connections";
    return NextResponse.redirect(url);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/api/:path*"],
};
