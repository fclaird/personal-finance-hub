import { headers } from "next/headers";

import { requestOrigin, schwabListenMismatch } from "@/lib/schwab/listenOrigin";

import ConnectionsPage from "./connections-client";

export default async function Page() {
  const headerList = await headers();
  const redirectUri = process.env.SCHWAB_REDIRECT_URI ?? null;
  const pageOrigin = requestOrigin(headerList.get("host"), headerList.get("x-forwarded-proto"));
  const listenWarning = pageOrigin ? schwabListenMismatch(pageOrigin, redirectUri) : null;
  return <ConnectionsPage listenWarning={listenWarning} />;
}
