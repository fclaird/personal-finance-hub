/** Extra Wikipedia search phrases for tickers with weak or missing issuer pages. */
export const ETF_WIKI_ALIASES: Record<string, string[]> = {
  GLDM: ["SPDR Gold Shares", "SPDR Gold MiniShares"],
  IAU: ["iShares Gold Trust"],
  SLV: ["iShares Silver Trust"],
  SPY: ["SPDR S&P 500 ETF Trust"],
  QQQ: ["Invesco QQQ"],
  DIA: ["SPDR Dow Jones Industrial Average ETF"],
};

export function isGarbledIssuerName(name: string | null | undefined): boolean {
  const s = (name ?? "").trim();
  if (s.length < 8) return false;
  if (/\bPr\s+In\b/i.test(s)) return true;
  if (/\bS\.?a\.?\s+S&p/i.test(s) && /etf/i.test(s)) return true;
  const words = s.split(/\s+/);
  const tiny = words.filter((w) => w.length <= 2).length;
  return tiny >= Math.max(3, words.length * 0.25);
}
