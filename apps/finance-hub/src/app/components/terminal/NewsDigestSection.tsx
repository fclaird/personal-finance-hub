"use client";

import { NewsFeedPanel } from "@/app/components/terminal/NewsFeedPanel";

type Props = {
  symbols: string[];
  anomalySymbols: string[];
  maxItems?: number;
};

export function NewsDigestSection({ symbols, anomalySymbols, maxItems = 24 }: Props) {
  return (
    <NewsFeedPanel
      title="Market news"
      mode="default"
      symbols={symbols}
      anomalySymbols={anomalySymbols}
      maxItems={maxItems}
    />
  );
}
