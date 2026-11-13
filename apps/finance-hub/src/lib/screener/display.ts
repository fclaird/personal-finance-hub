import { correlationBand } from "@/lib/screener/bands";
import type { Cited } from "@/lib/screener/types";

export function formatMarketCap(value: number | null, printed?: string | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  if (printed && printed.trim()) return printed;
  const abs = Math.abs(value);
  const sign = value < 0 ? "-" : "";
  if (abs >= 1e12) return `${sign}$${(abs / 1e12).toFixed(3).replace(/0+$/, "").replace(/\.$/, "")}T`;
  if (abs >= 1e9) return `${sign}$${(abs / 1e9).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}B`;
  if (abs >= 1e6) return `${sign}$${(abs / 1e6).toFixed(2).replace(/0+$/, "").replace(/\.$/, "")}M`;
  return `${sign}$${abs.toFixed(0)}`;
}

export function formatRatio(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  return value.toFixed(2);
}

export function formatCorrelation(value: number | null): string {
  if (value == null || !Number.isFinite(value)) return "—";
  const band = correlationBand(value);
  const two = value.toFixed(2);
  const twoBand = correlationBand(Number(two));
  const shown = band != null && twoBand != null && band !== twoBand ? value.toFixed(3) : two;
  return band ? `${shown} ${band}` : shown;
}

export function formatPlain(cited: Cited, kind: "cap" | "ratio" | "corr" | "text"): string {
  if (kind === "text") return cited.valueText?.trim() || "—";
  if (kind === "cap") {
    const printed = typeof cited.meta?.marketCapText === "string" ? cited.meta.marketCapText : null;
    return formatMarketCap(cited.valueNum, cited.source === "report:2026-11-12-close" ? printed : null);
  }
  if (kind === "corr") return formatCorrelation(cited.valueNum);
  return formatRatio(cited.valueNum);
}

export function citationLines(cited: Cited): string[] {
  if (cited.valueNum == null && !cited.valueText) return ["No cited value."];
  const lines = [
    cited.source ? `Source: ${cited.source}` : "Source: unknown",
    cited.asOf ? `As of: ${cited.asOf}` : "As of: not provided",
  ];
  if (cited.fetchedAt) lines.push(`Fetched: ${cited.fetchedAt}`);
  if (cited.sourceUrl) lines.push(cited.sourceUrl);
  if (cited.singleSource) lines.push("Single source.");
  if (cited.disagreement) lines.push("Disagrees with another source by more than 5%.");
  const growth = cited.meta?.growthRateLabel;
  if (typeof growth === "string") lines.push(`PEG growth rate: ${growth}`);
  if (cited.meta?.estimate === true) lines.push("Consensus estimate.");
  if (cited.meta?.shortHistory === true) {
    const note = typeof cited.meta.historyNote === "string" ? cited.meta.historyNote : "History is shorter than the window.";
    lines.push(note);
  }
  if (cited.meta?.shareClassesCombined === true) lines.push("Report combined share classes into this figure.");
  const formula = cited.meta?.formula;
  if (typeof formula === "string") lines.push(`Formula: ${formula}`);
  for (const peer of cited.peers) {
    const shown = peer.valueText ?? (peer.valueNum != null ? String(peer.valueNum) : "—");
    const gap = peer.relativeGap != null ? ` (${(peer.relativeGap * 100).toFixed(1)}% apart)` : "";
    const kind = peer.otherClassification ? "other classification" : "also";
    lines.push(`${kind}: ${peer.source} ${shown}${peer.asOf ? ` as of ${peer.asOf}` : ""}${gap}`);
  }
  return lines;
}
