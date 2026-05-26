import { buildCashIndexGlanceCard } from "@/lib/market/cashIndexGlanceCard";
import { buildFuturesGlanceCard } from "@/lib/market/futuresGlanceCard";
import type { GlanceTimedGrid } from "@/lib/market/glanceSessionGrid";
import type { RegionalMarketInstrument } from "@/lib/market/regionalMarketInstruments";
import { REGIONAL_MARKET_INSTRUMENTS, WTI_CRUDE_INSTRUMENT } from "@/lib/market/regionalMarketInstruments";
import {
  buildSymbolGlanceCard,
  RUSSELL_2000_INDEX,
  type UsMarketIndexCard,
} from "@/lib/market/usMarketIndices";

const NIKKEI_225_INSTRUMENT =
  REGIONAL_MARKET_INSTRUMENTS.find((def) => def.id === "jp-n225") ??
  ({
    id: "jp-n225",
    region: "jp",
    label: "Nikkei 225",
    yahooSymbol: "^N225",
  } satisfies RegionalMarketInstrument);

const GOLD_INSTRUMENT: RegionalMarketInstrument = {
  id: "gold",
  region: "us",
  label: "Gold",
  yahooSymbol: "GC=F",
  stooqSymbol: "gc.f",
  includePrePost: true,
};

const FTSE_100_INSTRUMENT: RegionalMarketInstrument = {
  id: "ftse100",
  region: "uk",
  label: "FTSE 100",
  yahooSymbol: "^FTSE",
};

export async function fetchGlanceAlternateCards(
  now: Date = new Date(),
  grid?: GlanceTimedGrid,
): Promise<UsMarketIndexCard[]> {
  const [russell2000, gold, bitcoin, wtiCrude, nikkei225, ftse100] = await Promise.all([
    buildSymbolGlanceCard(RUSSELL_2000_INDEX, now, grid),
    buildFuturesGlanceCard(GOLD_INSTRUMENT, now),
    buildSymbolGlanceCard({ id: "bitcoin", label: "Bitcoin", symbol: "BTC-USD" }, now, grid).then(
      (card) => ({ ...card, tradableOpen: true }),
    ),
    buildFuturesGlanceCard(WTI_CRUDE_INSTRUMENT, now),
    buildCashIndexGlanceCard(NIKKEI_225_INSTRUMENT, now),
    buildCashIndexGlanceCard(FTSE_100_INSTRUMENT, now),
  ]);
  return [russell2000, gold, bitcoin, wtiCrude, nikkei225, ftse100];
}
