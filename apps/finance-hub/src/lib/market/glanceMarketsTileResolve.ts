import type { GlanceTileInstrumentId } from "@/lib/market/glanceTileInstruments";
import { resolveGlanceInstrumentId } from "@/lib/market/glanceMiniChartSession";

/**
 * Auto-map cash index slots to e-minis outside US RTH.
 * Slot index is unused: Nasdaq, S&P, and Russell switch in any markets slot.
 * See `GLANCE_CLOSED_SESSION_PROXY`.
 */
export function resolveMarketsSlotInstrumentId(
  _slotIndex: 2 | 3 | 4,
  storedId: GlanceTileInstrumentId,
  now: Date = new Date(),
): GlanceTileInstrumentId {
  return resolveGlanceInstrumentId(storedId, now) as GlanceTileInstrumentId;
}
