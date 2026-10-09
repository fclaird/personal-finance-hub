import { NextResponse } from "next/server";

import { getOptionChain } from "@/lib/optionChain/server";

/** Full option chain for Strategy Lab. Read only: Schwab market data, then Cboe delayed. */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const symbol = url.searchParams.get("symbol") ?? "";
  const refresh = url.searchParams.get("refresh") === "1";
  const result = await getOptionChain(symbol, { refresh });
  return NextResponse.json(result);
}
