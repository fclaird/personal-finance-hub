export type PortfolioChangeCaption =
  | { kind: "day" }
  | { kind: "since"; baselineYmd: string; sessionYmd: string };

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"] as const;

export function portfolioSinceLabel(baselineYmd: string, sessionYmd: string): string {
  const [y, m, d] = baselineYmd.split("-").map(Number);
  const month = MONTHS[(m ?? 0) - 1];
  if (!y || !month || !d) return "since last sync";
  const sessionYear = Number(sessionYmd.slice(0, 4));
  if (y !== sessionYear) return `since ${month} ${d}, ${y}`;
  return `since ${month} ${d}`;
}

export function portfolioChangeLabel(caption: PortfolioChangeCaption | null | undefined): string {
  if (caption == null || caption.kind === "day") return "Day";
  return portfolioSinceLabel(caption.baselineYmd, caption.sessionYmd);
}

export function portfolioBaselineNote(caption: PortfolioChangeCaption | null | undefined): string | null {
  if (caption == null || caption.kind !== "since") return null;
  return `Last stored baseline is ${caption.baselineYmd}, not the prior session close`;
}
