import { cookies } from "next/headers";

import { FLAVOR_COOKIE, parseFlavor, type FlavorId } from "@/lib/flavor";

export async function flavorFromCookies(fallback: FlavorId = "main"): Promise<FlavorId> {
  const jar = await cookies();
  return parseFlavor(jar.get(FLAVOR_COOKIE)?.value) ?? fallback;
}
