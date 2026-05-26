import { japanEquitySessionStatus, koreaEquitySessionStatus } from "@/lib/market/asiaEquitySession";
import { fetchReconciledOpenQuote } from "@/lib/market/reconciledOpenQuote";
import {
  REGIONAL_MARKET_INSTRUMENTS,
  REGIONAL_MARKET_LABELS,
  type RegionalMarketId,
} from "@/lib/market/regionalMarketInstruments";
import { usEquitySessionStatus } from "@/lib/market/usEquitySession";

export type RegionalMarketItem = {
  id: string;
  region: RegionalMarketId;
  regionLabel: string;
  label: string;
  yahooSymbol: string;
  last: number | null;
  change: number | null;
  changePct: number | null;
  previousClose: number | null;
  reconciled: boolean;
  divergencePct: number | null;
  sources: {
    yahoo: number | null;
    yahooBar: number | null;
    stooq: number | null;
  };
  series: Array<{ date: string; close: number }>;
  session: { headline: string; detail: string; isOpen: boolean };
};

function sessionForRegion(region: RegionalMarketId, now: Date) {
  if (region === "us") {
    const s = usEquitySessionStatus(now);
    return { headline: s.headline, detail: s.detail, isOpen: s.isOpen };
  }
  if (region === "jp") {
    const s = japanEquitySessionStatus(now);
    return { headline: s.headline, detail: s.detail, isOpen: s.isOpen };
  }
  const s = koreaEquitySessionStatus(now);
  return { headline: s.headline, detail: s.detail, isOpen: s.isOpen };
}

export async function fetchRegionalMarketItems(now: Date = new Date()): Promise<RegionalMarketItem[]> {
  const items: RegionalMarketItem[] = [];
  for (const def of REGIONAL_MARKET_INSTRUMENTS) {
    const quote = await fetchReconciledOpenQuote(def);
    if (quote.last == null && quote.series.length === 0) continue;
    items.push({
      id: def.id,
      region: def.region,
      regionLabel: REGIONAL_MARKET_LABELS[def.region],
      label: def.label,
      yahooSymbol: def.yahooSymbol,
      last: quote.last,
      change: quote.change,
      changePct: quote.changePct,
      previousClose: quote.previousClose,
      reconciled: quote.reconciled,
      divergencePct: quote.divergencePct,
      sources: quote.sources,
      series: quote.series,
      session: sessionForRegion(def.region, now),
    });
  }
  return items;
}
