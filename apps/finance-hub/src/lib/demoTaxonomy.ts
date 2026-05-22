import { normalizeSectorLabel } from "@/lib/sectorLabel";

export type Taxonomy = {
  sector: string;
  marketCap: "mega" | "large" | "mid" | "small" | "micro" | "unknown";
  revenueGeo: "US" | "Intl" | "Mixed" | "unknown";
};

export type TaxonomyCategory = "sector" | "marketCap" | "revenueGeo";

export const DEMO_TAXONOMY: Record<string, Taxonomy> = {
  AAPL: { sector: "Technology", marketCap: "mega", revenueGeo: "Mixed" },
  MSFT: { sector: "Software", marketCap: "mega", revenueGeo: "Mixed" },
  AMZN: { sector: "Consumer", marketCap: "mega", revenueGeo: "Mixed" },
  TSLA: { sector: "Consumer", marketCap: "large", revenueGeo: "Mixed" },
  PLTR: { sector: "Software", marketCap: "large", revenueGeo: "US" },
  RKLB: { sector: "Space and rocket technology", marketCap: "small", revenueGeo: "US" },
  NBIS: { sector: "Data center hardware", marketCap: "mid", revenueGeo: "Intl" },
  ORC: { sector: "Real Estate", marketCap: "small", revenueGeo: "US" },
  ORCL: { sector: "Data center hardware", marketCap: "mega", revenueGeo: "Mixed" },
  SPY: { sector: "Index", marketCap: "mega", revenueGeo: "Mixed" },
  QQQ: { sector: "Index", marketCap: "mega", revenueGeo: "Mixed" },
  BND: { sector: "Fixed income", marketCap: "mega", revenueGeo: "US" },
  CASH: { sector: "Cash", marketCap: "unknown", revenueGeo: "US" },
  BTCUSD: { sector: "Crypto", marketCap: "unknown", revenueGeo: "unknown" },
  ETHUSD: { sector: "Crypto", marketCap: "unknown", revenueGeo: "unknown" },
  VG: { sector: "Oil & gas", marketCap: "micro", revenueGeo: "US" },
  NEXT: { sector: "Energy", marketCap: "small", revenueGeo: "US" },
  BMNR: { sector: "Crypto", marketCap: "micro", revenueGeo: "US" },
};

export function taxonomyForSymbol(sym: string): Taxonomy {
  const s = (sym ?? "").toUpperCase();
  return (
    DEMO_TAXONOMY[s] ?? {
      sector: "Unknown",
      marketCap: "unknown",
      revenueGeo: "unknown",
    }
  );
}

export function taxonomyBucket(sym: string, category: TaxonomyCategory): string {
  const s = (sym ?? "").trim().toUpperCase();
  if (category === "marketCap") return s || "unknown";
  const t = taxonomyForSymbol(sym);
  return category === "sector" ? normalizeSectorLabel(t.sector) : t.revenueGeo;
}
