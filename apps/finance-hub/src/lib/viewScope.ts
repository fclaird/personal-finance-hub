import { cookies } from "next/headers";

import { DATA_MODE_COOKIE, parseDataMode, type DataMode } from "@/lib/dataMode";
import { FLAVOR_COOKIE, parseFlavor, type FlavorId } from "@/lib/flavor";

export type ViewScope = {
  flavor: FlavorId;
  dataMode: DataMode;
};

export async function resolveViewScope(fallbackFlavor: FlavorId = "main"): Promise<ViewScope> {
  const jar = await cookies();
  return {
    flavor: parseFlavor(jar.get(FLAVOR_COOKIE)?.value) ?? fallbackFlavor,
    dataMode: parseDataMode(jar.get(DATA_MODE_COOKIE)?.value),
  };
}
