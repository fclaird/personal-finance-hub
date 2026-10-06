import { headers } from "next/headers";

import { parseFlavor, type FlavorId } from "@/lib/flavor";
import { requestOrigin, schwabListenMismatch } from "@/lib/schwab/listenOrigin";

import ConnectionsPage from "./connections-client";

export default async function Page({
  searchParams,
}: {
  searchParams: Promise<{ flavorUnlock?: string; flavor?: string }>;
}) {
  const headerList = await headers();
  const params = await searchParams;
  const redirectUri = process.env.SCHWAB_REDIRECT_URI ?? null;
  const pageOrigin = requestOrigin(headerList.get("host"), headerList.get("x-forwarded-proto"));
  const listenWarning = pageOrigin ? schwabListenMismatch(pageOrigin, redirectUri) : null;
  const initialPendingFlavor: FlavorId | null =
    params.flavorUnlock === "invalid" ? parseFlavor(params.flavor) : null;
  return (
    <ConnectionsPage
      listenWarning={listenWarning}
      initialPendingFlavor={initialPendingFlavor}
      initialUnlockError={initialPendingFlavor ? "Incorrect password" : null}
    />
  );
}
