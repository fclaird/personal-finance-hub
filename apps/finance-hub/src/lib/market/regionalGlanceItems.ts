import { buildCashIndexGlanceCard, isCashIndexInstrument } from "@/lib/market/cashIndexGlanceCard";
import { buildFuturesGlanceCard } from "@/lib/market/futuresGlanceCard";
import { REGIONAL_MARKET_INSTRUMENTS } from "@/lib/market/regionalMarketInstruments";
import type { UsMarketIndexCard } from "@/lib/market/usMarketIndices";

/** Global futures and cash indices for quick-glance Futures tab (ES, NQ, Nikkei). */
export async function fetchRegionalGlanceItems(now: Date = new Date()): Promise<UsMarketIndexCard[]> {
  const items: UsMarketIndexCard[] = [];
  for (const def of REGIONAL_MARKET_INSTRUMENTS) {
    if (isCashIndexInstrument(def)) {
      items.push(await buildCashIndexGlanceCard(def, now));
    } else {
      items.push(await buildFuturesGlanceCard(def, now));
    }
  }
  return items;
}
