import type { GlanceTileInstrumentId } from "@/lib/market/glanceTileInstruments";
import { isUsEquityRegularSessionOpen } from "@/lib/market/usEquitySession";

/** Auto-map equity index slots to e-mini outside US RTH when user kept the equity default. */
export function resolveMarketsSlotInstrumentId(
  slotIndex: 2 | 3,
  storedId: GlanceTileInstrumentId,
  now: Date = new Date(),
): GlanceTileInstrumentId {
  if (isUsEquityRegularSessionOpen(now)) return storedId;
  if (slotIndex === 2 && storedId === "nasdaq") return "us-nq";
  if (slotIndex === 3 && storedId === "sp500") return "us-es";
  return storedId;
}
